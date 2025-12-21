import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Plugin, ViteDevServer, ResolvedConfig } from "vite";

export interface MoonBitPluginOptions {
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
   * Build target: "release" or "debug"
   * @default "release"
   */
  target?: "release" | "debug";

  /**
   * Whether to show MoonBit build logs
   * @default true
   */
  showLogs?: boolean;
}

interface ModuleInfo {
  name: string;
  source: string;
}

const MBT_PREFIX = "mbt:";
const VIRTUAL_MODULE_PREFIX = "\0mbt:";

export default function moonbitPlugin(
  options: MoonBitPluginOptions = {}
): Plugin {
  const {
    root = process.cwd(),
    watch: watchOption,
    target = "release",
    showLogs = true,
  } = options;

  let config: ResolvedConfig;
  let server: ViteDevServer | null = null;
  let moonProcess: ChildProcess | null = null;
  let moduleInfo: ModuleInfo | null = null;
  let logBuffer: string[] = [];
  let isBuilding = false;
  let lastBuildSuccess = false;

  const buildDir = path.join(root, "target", "js", target, "build");

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
      // e.g., "test/app" -> "app.js"
      const rootModuleName = moduleNameParts[moduleNameParts.length - 1];
      return path.join(buildDir, `${rootModuleName}.js`);
    }

    // Build the file path: target/js/release/build/path/to/module/module.js
    const moduleName = pathParts[pathParts.length - 1];
    const modulePath = path.join(buildDir, ...pathParts, `${moduleName}.js`);

    return modulePath;
  }

  function flushLogBuffer(): string[] {
    const logs = [...logBuffer];
    logBuffer = [];
    return logs;
  }

  function log(message: string, type: "info" | "warn" | "error" = "info") {
    const prefix = "[moonbit]";
    const formattedMessage = `${prefix} ${message}`;
    logBuffer.push(formattedMessage);

    if (showLogs) {
      switch (type) {
        case "error":
          console.error(formattedMessage);
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

    log("Starting moon build --watch...");
    isBuilding = true;

    moonProcess = spawn("moon", ["build", "--target", "js", "--watch"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    moonProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        output.split("\n").forEach((line) => {
          log(line);

          // Detect build completion
          if (
            line.includes("Finished") ||
            line.includes("Build completed") ||
            line.includes("moon: ran")
          ) {
            isBuilding = false;
            lastBuildSuccess = true;
            triggerHMR();
          }
        });
      }
    });

    moonProcess.stderr?.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        output.split("\n").forEach((line) => {
          log(line, "error");

          // Detect build errors
          if (line.includes("error") || line.includes("Error")) {
            isBuilding = false;
            lastBuildSuccess = false;
          }
        });
      }
    });

    moonProcess.on("close", (code) => {
      log(`moon build process exited with code ${code}`);
      moonProcess = null;
      isBuilding = false;
    });

    moonProcess.on("error", (err) => {
      log(`Failed to start moon build: ${err.message}`, "error");
      moonProcess = null;
      isBuilding = false;
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
        (eventType, filename) => {
          if (filename?.endsWith(".js")) {
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

        // Log buffered messages and return null to let Vite handle the error
        const logs = flushLogBuffer();
        if (logs.length > 0) {
          console.log("\n--- MoonBit Build Logs ---");
          logs.forEach((l) => console.log(l));
          console.log("----------------------------\n");
        }

        console.error(
          `[moonbit] Could not resolve: ${id} -> ${resolved || "unknown"}`
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
          const content = fs.readFileSync(resolved, "utf-8");

          // Flush any buffered logs
          const logs = flushLogBuffer();
          if (logs.length > 0 && isBuilding) {
            console.log("\n--- MoonBit Build Logs ---");
            logs.forEach((l) => console.log(l));
            console.log("----------------------------\n");
          }

          return content;
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

export { moonbitPlugin };
