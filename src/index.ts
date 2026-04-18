import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Plugin, ViteDevServer, ResolvedConfig } from "vite";

export interface MoonbitPluginOptions {
  /**
   * Root directory of the MoonBit project (where moon.mod.json is located)
   * @default process.cwd()
   */
  root?: string;

  /**
   * Whether to start `moon build --watch` subprocess
   * @default true in dev mode
   */
  watch?: boolean;

  /**
   * Build mode: "release" or "debug"
   * @default "release"
   */
  mode?: "release" | "debug";

  /**
   * Build target: "js", "wasm", or "wasm-gc"
   * @default "js"
   */
  target?: "js" | "wasm" | "wasm-gc";

  /**
   * Whether to show MoonBit build logs
   * @default true
   */
  showLogs?: boolean;

  /**
   * Enables support for JS String Builtins in `wasm-gc` target.
   * Required when using `"use-js-builtin-string": true` in MoonBit configuration.
   * 
   * @default false
   */
  useJsBuiltinString?: boolean;
}

interface Member {
  name: string;
  source: string;
  memberDir: string;
}

interface ProjectInfo {
  workspaceRoot: string;
  members: Member[];
  isWorkspace: boolean;
}

const MBT_PREFIX = "mbt:";
const VIRTUAL_MODULE_PREFIX = "\0mbt:";
const MOON_WORK_FILES = ["moon.work", "moon.work.json"];

export default function moonbitPlugin(
  options: MoonbitPluginOptions = {}
): Plugin {
  const {
    root = process.cwd(),
    watch: watchOption,
    mode = "release",
    target = "js",
    showLogs = true,
    useJsBuiltinString = false,
  } = options;

  let config: ResolvedConfig;
  let server: ViteDevServer | null = null;
  let moonProcess: ChildProcess | null = null;
  let projectInfo: ProjectInfo | null = null;
  let logBuffer: string[] = [];
  let errorBuffer: string[] = [];

  const fileExt = target === "js" ? ".js" : ".wasm";

  function getBuildDir(): string {
    const base = projectInfo?.workspaceRoot ?? root;
    return path.join(base, "_build", target, mode, "build");
  }

  function readMemberInfo(memberDir: string): Member | null {
    try {
      const content = fs.readFileSync(
        path.join(memberDir, "moon.mod.json"),
        "utf-8"
      );
      const mod = JSON.parse(content);
      if (!mod.name) return null;
      return {
        name: mod.name,
        source: mod.source || "src",
        memberDir,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse the TOML-like DSL used by `moon.work`.
   * Only `members = [...]` is consumed here; other keys are ignored.
   * `moon.work.json` is parsed as plain JSON.
   */
  function parseWorkspaceManifest(
    manifestPath: string
  ): { members: string[] } | null {
    try {
      const content = fs.readFileSync(manifestPath, "utf-8");
      if (manifestPath.endsWith(".json")) {
        const parsed = JSON.parse(content);
        return {
          members: Array.isArray(parsed.members) ? parsed.members : [],
        };
      }
      // moon.work DSL: find `members = [...]` block and extract quoted strings.
      const match = content.match(/members\s*=\s*\[([\s\S]*?)\]/);
      if (!match) return { members: [] };
      const members = Array.from(match[1].matchAll(/"([^"]*)"/g)).map(
        (m) => m[1]
      );
      return { members };
    } catch {
      return null;
    }
  }

  function workspaceManifestAt(dir: string): string | null {
    for (const name of MOON_WORK_FILES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  function parseMembers(manifestPath: string): Member[] {
    const parsed = parseWorkspaceManifest(manifestPath);
    if (!parsed) return [];
    const workspaceRoot = path.dirname(manifestPath);
    const members: Member[] = [];
    for (const memberPath of parsed.members) {
      const memberDir = path.resolve(workspaceRoot, memberPath);
      const member = readMemberInfo(memberDir);
      if (member) members.push(member);
      else
        console.warn(
          `[moonbit] workspace member has no readable moon.mod.json: ${memberDir}`
        );
    }
    return members;
  }

  /**
   * Mirrors moon's own logic (`find_applicable_workspace_manifest_path`):
   * walk ancestors, prefer the nearest `moon.mod.json` when it is not a member
   * of any ancestor workspace. A `moon.work` only wins if the nearest module
   * is listed in its `members` (or no module has been seen yet).
   */
  function readProjectInfo(): ProjectInfo | null {
    let dir = path.resolve(root);
    let nearestModuleDir: string | null = null;

    while (true) {
      const workspaceManifest = workspaceManifestAt(dir);
      if (workspaceManifest) {
        const members = parseMembers(workspaceManifest);
        const workspaceRoot = path.dirname(workspaceManifest);
        const memberDirs = new Set(
          members.map((m) => path.resolve(m.memberDir))
        );
        if (nearestModuleDir === null || memberDirs.has(nearestModuleDir)) {
          return { workspaceRoot, members, isWorkspace: true };
        }
        // Nearest module is not a member of this workspace: skip and keep walking.
      } else if (
        nearestModuleDir === null &&
        fs.existsSync(path.join(dir, "moon.mod.json"))
      ) {
        nearestModuleDir = dir;
      }

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    if (nearestModuleDir) {
      const member = readMemberInfo(nearestModuleDir);
      if (!member) return null;
      return {
        workspaceRoot: nearestModuleDir,
        members: [member],
        isWorkspace: false,
      };
    }
    return null;
  }

  /**
   * Pick the member whose `name` is the longest slash-separated prefix of `parts`.
   */
  function matchMember(parts: string[]): Member | null {
    if (!projectInfo) return null;
    let best: Member | null = null;
    let bestLen = 0;
    for (const member of projectInfo.members) {
      const segs = member.name.split("/");
      if (segs.length > parts.length) continue;
      const prefix = parts.slice(0, segs.length);
      if (prefix.join("/") !== member.name) continue;
      if (segs.length > bestLen) {
        best = member;
        bestLen = segs.length;
      }
    }
    return best;
  }

  function resolveModulePath(id: string): string | null {
    const candidates = resolveCandidates(id);
    if (candidates.length === 0) return null;
    // Return the first existing candidate, else the first candidate as the
    // reported path for the "could not resolve" error message.
    return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
  }

  /**
   * If the id refers to a package that moon marked as `virtual` or
   * `implement`, return a hint string explaining why no .js exists — those
   * packages only contribute .mi/.core intermediates and are link-absorbed
   * into whatever package declares `overrides` for them.
   */
  function overrideHint(id: string): string | null {
    if (!projectInfo) return null;
    const parts = id.slice(MBT_PREFIX.length).split("/");
    const member = matchMember(parts);
    if (!member) return null;
    const pkgParts = parts.slice(member.name.split("/").length);
    const pkgDir = path.join(member.memberDir, member.source, ...pkgParts);
    const pkgJson = path.join(pkgDir, "moon.pkg.json");
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
      if (parsed.virtual) {
        return `${id} is a virtual package (declared in ${path.relative(root, pkgJson)}). Virtual packages have no runtime output — import the app/main package that selects an implementation via \`overrides\` instead.`;
      }
      if (parsed.implement) {
        return `${id} is an implementation of \`${parsed.implement}\` (declared in ${path.relative(root, pkgJson)}). Implementations are linked by the app that declares \`overrides\` and do not produce a standalone .js.`;
      }
    } catch {
      // no moon.pkg.json here, fall through
    }
    return null;
  }

  function resolveCandidates(id: string): string[] {
    if (!projectInfo) return [];

    const parts = id.slice(MBT_PREFIX.length).split("/");
    const member = matchMember(parts);
    if (!member) return [];

    const memberNameSegs = member.name.split("/");
    const pkgParts = parts.slice(memberNameSegs.length);
    const shortAlias =
      pkgParts.length > 0
        ? pkgParts[pkgParts.length - 1]
        : memberNameSegs[memberNameSegs.length - 1];

    const buildDir = getBuildDir();
    // Moon may flatten a single-member workspace (single-root compatibility
    // layout) or nest (multi-root). Try both in workspace mode.
    const flat = path.join(buildDir, ...pkgParts, `${shortAlias}${fileExt}`);
    if (!projectInfo.isWorkspace) return [flat];

    const nested = path.join(
      buildDir,
      ...memberNameSegs,
      ...pkgParts,
      `${shortAlias}${fileExt}`
    );
    return [nested, flat];
  }

  function clearErrorBuffer() {
    errorBuffer = [];
  }

  function printErrorBuffer() {
    if (errorBuffer.length === 0) return;

    // Print separator line
    console.log("\n");

    // Print header in red
    console.log("\x1b[1;31m--- MoonBit Build Errors ---\x1b[0m\n");

    // Print errors with preserved ANSI colors
    errorBuffer.forEach((line) => {
      process.stderr.write(line + "\n");
    });

    console.log("\n\x1b[1;31m----------------------------\x1b[0m\n");
  }

  function printBuildSuccess() {
    console.log("\n\x1b[1;32m--- MoonBit Build OK ---\x1b[0m\n");
  }

  function log(message: string, type: "info" | "warn" | "error" = "info") {
    const prefix = "\x1b[36m[moonbit]\x1b[0m";
    const formattedMessage = `${prefix} ${message}`;
    logBuffer.push(formattedMessage);

    if (showLogs) {
      switch (type) {
        case "error":
          // Store raw error message with ANSI codes preserved
          errorBuffer.push(message);
          // Also print immediately
          process.stderr.write(formattedMessage + "\n");
          break;
        case "warn":
          console.warn(formattedMessage);
          break;
        default:
          console.log(formattedMessage);
      }
    }
  }

  function startWatchProcess() {
    if (moonProcess) return;

    const cwd = projectInfo?.workspaceRoot ?? root;
    const args = ["build", "--target", target, "--watch"];
    // moon defaults to debug; pass --release when the plugin is in release mode
    // so the watch output lands where the resolver looks.
    if (mode === "release") args.push("--release");

    log(`Starting moon ${args.join(" ")} (cwd=${cwd})...`);
    moonProcess = spawn("moon", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, FORCE_COLOR: "1" }, // Force ANSI colors
    });

    moonProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      if (output) {
        output.split("\n").forEach((line) => {
          if (!line.trim()) return;

          // Detect build start (file watching)
          if (line.includes("Watching")) {
            clearErrorBuffer();
          }

          log(line);

          // Detect build completion
          if (
            line.includes("Finished") ||
            line.includes("Build completed") ||
            line.includes("moon: ran")
          ) {
            clearErrorBuffer();
            printBuildSuccess();
            triggerHMR();
          }
        });
      }
    });

    moonProcess.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      if (output) {
        // Print header on first error in this session
        if (errorBuffer.length === 0) {
          console.log("\n\x1b[1;31m--- MoonBit Build Errors ---\x1b[0m\n");
        }

        output.split("\n").forEach((line) => {
          if (!line) return;

          // Store raw error with ANSI codes
          errorBuffer.push(line);
          // Print immediately with preserved colors
          process.stderr.write(line + "\n");
        });
      }
    });

    moonProcess.on("close", (code) => {
      log(`moon build process exited with code ${code}`);
      moonProcess = null;
    });

    moonProcess.on("error", (err) => {
      log(`Failed to start moon build: ${err.message}`, "error");
      moonProcess = null;
    });
  }

  function stopWatchProcess() {
    if (moonProcess) {
      log("Stopping moon build --watch...");
      moonProcess.kill("SIGTERM");
      moonProcess = null;
    }
  }

  function triggerHMR() {
    if (!server) return;

    // Find all modules that start with our virtual prefix and invalidate them
    const modulesToInvalidate = [...server.moduleGraph.idToModuleMap.entries()]
      .filter(([id]) => id.startsWith(VIRTUAL_MODULE_PREFIX))
      .map(([, mod]) => mod);

    if (modulesToInvalidate.length > 0) {
      log(`Triggering HMR for ${modulesToInvalidate.length} MoonBit modules`);
      modulesToInvalidate.forEach((mod) => {
        server!.moduleGraph.invalidateModule(mod);
      });

      // Send full reload for now (could be optimized with proper HMR)
      server.ws.send({
        type: "full-reload",
        path: "*",
      });
    }
  }

  // Watch for changes in the build directory
  let buildWatcher: fs.FSWatcher | null = null;

  function startBuildWatcher() {
    if (buildWatcher) return;

    try {
      const buildDir = getBuildDir();
      // Ensure build directory exists
      if (!fs.existsSync(buildDir)) {
        log(`Build directory does not exist yet: ${buildDir}`, "warn");
        return;
      }

      buildWatcher = fs.watch(
        buildDir,
        { recursive: true },
        (_eventType, filename) => {
          if (filename?.endsWith(fileExt)) {
            // Clear errors on successful rebuild
            clearErrorBuffer();
            log(`Detected change: ${filename}`);
            triggerHMR();
          }
        }
      );

      log(`Watching build directory: ${buildDir}`);
    } catch (err) {
      log(`Failed to watch build directory: ${err}`, "warn");
    }
  }

  function stopBuildWatcher() {
    if (buildWatcher) {
      buildWatcher.close();
      buildWatcher = null;
    }
  }

  return {
    name: "vite-plugin-moonbit",
    enforce: "pre",

    config() {
      return {
        optimizeDeps: {
          // Exclude mbt: imports from dependency pre-bundling
          exclude: ["mbt:*"],
        },
        resolve: {
          // Allow mbt: as external prefix
          external: [],
        },
      };
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      projectInfo = readProjectInfo();

      if (!projectInfo) {
        console.warn(
          "[moonbit] Could not find moon.work, moon.work.json, or moon.mod.json starting from",
          root
        );
      } else if (projectInfo.isWorkspace) {
        log(
          `workspace mode (${projectInfo.members.length} members): ${projectInfo.members
            .map((m) => m.name)
            .join(", ")}`
        );
      } else {
        log(`single-module mode: ${projectInfo.members[0].name}`);
      }
    },

    configureServer(devServer) {
      server = devServer;

      const shouldWatch =
        watchOption !== undefined ? watchOption : config.command === "serve";

      if (shouldWatch) {
        startWatchProcess();
        startBuildWatcher();
      }

      // Cleanup on server close
      devServer.httpServer?.on("close", () => {
        stopWatchProcess();
        stopBuildWatcher();
      });
    },

    resolveId(id) {
      if (id.startsWith(MBT_PREFIX)) {
        const resolved = resolveModulePath(id);
        if (resolved && fs.existsSync(resolved)) {
          // Return a virtual module ID
          return VIRTUAL_MODULE_PREFIX + id.slice(MBT_PREFIX.length);
        }

        // Show errors with preserved colors when module resolution fails
        if (errorBuffer.length > 0) {
          printErrorBuffer();
        }

        console.error(
          `\x1b[31m[moonbit] Could not resolve: ${id} -> ${resolved || "unknown"}\x1b[0m`
        );
        const hint = overrideHint(id);
        if (hint) console.error(`\x1b[33m[moonbit] hint: ${hint}\x1b[0m`);
        return null;
      }
      return null;
    },

    load(id) {
      if (id.startsWith(VIRTUAL_MODULE_PREFIX)) {
        const modulePath = id.slice(VIRTUAL_MODULE_PREFIX.length);
        const fullId = MBT_PREFIX + modulePath;
        const resolved = resolveModulePath(fullId);

        if (resolved && fs.existsSync(resolved)) {
          if (target === "js") {
            // JS backend: return the JS file content directly
            const content = fs.readFileSync(resolved, "utf-8");
            return content;
          } else {
            // WASM backend: generate loader code using Vite's ?init
            // Use config.root (Vite's project root) instead of root (MoonBit root)
            // to correctly resolve paths in nested project structures
            const relativePath = path.relative(config.root, resolved).replace(/\\/g, "/");

            if (useJsBuiltinString) {
              // Vite's default `?init` helper does not allow passing the 3rd argument (compile options)
              // to `WebAssembly.instantiateStreaming`.
              // We need to implement a manual loader to enable `js-string-builtins`.
              return `
import wasmUrl from "/${relativePath}?url";

async function init(imports = {}) {
  const compileOptions = {
    builtins: ["js-string"],
    importedStringConstants: "_",
  };

  const { instance } = await WebAssembly.instantiateStreaming(
    fetch(wasmUrl),
    imports,
    compileOptions,
  );

  return instance;
}

export default init;
export { init };
`;
            } else {
              return `
import init from "/${relativePath}?init";

export default init;
export { init };
`;
            }
          }
        }

        // Show errors with preserved colors when module loading fails
        if (errorBuffer.length > 0) {
          printErrorBuffer();
        }

        throw new Error(`[moonbit] Module not found: ${resolved}`);
      }
      return null;
    },

    buildStart() {
      if (!projectInfo) {
        projectInfo = readProjectInfo();
      }
    },

    buildEnd() {
      stopWatchProcess();
      stopBuildWatcher();
    },
  };
}

export { moonbitPlugin as moonbit };
