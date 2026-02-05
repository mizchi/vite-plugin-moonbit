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

  useJsBuiltinString?: boolean;
}

interface ModuleInfo {
  name: string;
  source: string;
}

const MBT_PREFIX = "mbt:";
const VIRTUAL_MODULE_PREFIX = "\0mbt:";

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
  let moduleInfo: ModuleInfo | null = null;
  let logBuffer: string[] = [];
  let errorBuffer: string[] = [];

  const buildDir = path.join(root, "_build", target, mode, "build");
  const fileExt = target === "js" ? ".js" : ".wasm";

  function readModuleInfo(): ModuleInfo | null {
    const modPath = path.join(root, "moon.mod.json");
    try {
      const content = fs.readFileSync(modPath, "utf-8");
      const mod = JSON.parse(content);
      return {
        name: mod.name || "",
        source: mod.source || "src",
      };
    } catch {
      return null;
    }
  }

  function resolveModulePath(id: string): string | null {
    if (!moduleInfo) return null;

    // Parse mbt:username/pkg/path/to/module
    const parts = id.slice(MBT_PREFIX.length).split("/");
    if (parts.length < 2) return null;

    // Skip username/pkg (first two parts matching moon.mod.json name)
    const moduleNameParts = moduleInfo.name.split("/");
    const pathParts = parts.slice(moduleNameParts.length);

    // Handle root package (when pathParts is empty)
    if (pathParts.length === 0) {
      // Root package: use the last part of module name
      // e.g., "test/app" -> "app.js" or "app.wasm"
      const rootModuleName = moduleNameParts[moduleNameParts.length - 1];
      return path.join(buildDir, `${rootModuleName}${fileExt}`);
    }

    // Build the file path: target/{backend}/{mode}/build/path/to/module/module.{ext}
    const moduleName = pathParts[pathParts.length - 1];
    const modulePath = path.join(buildDir, ...pathParts, `${moduleName}${fileExt}`);

    return modulePath;
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

    log(`Starting moon build --target ${target} --watch...`);
    moonProcess = spawn("moon", ["build", "--target", target, "--watch"], {
      cwd: root,
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
      moduleInfo = readModuleInfo();

      if (!moduleInfo) {
        console.warn(
          "[moonbit] Could not find moon.mod.json in",
          root
        );
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
      if (!moduleInfo) {
        moduleInfo = readModuleInfo();
      }
    },

    buildEnd() {
      stopWatchProcess();
      stopBuildWatcher();
    },
  };
}

export { moonbitPlugin as moonbit };
