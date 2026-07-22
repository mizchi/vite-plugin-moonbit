import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin, ViteDevServer, ResolvedConfig } from "vite";
import {
  type Member,
  type ProjectInfo,
  readMoonManifest,
  readProjectInfo,
  readPkgManifest,
} from "./manifest.js";

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
   * If left undefined, the plugin auto-detects it by scanning the member
   * packages' `moon.pkg(.json)` files for `link.wasm-gc.use-js-builtin-string`.
   *
   * @default auto-detected from moon.pkg files
   */
  useJsBuiltinString?: boolean;

  /**
   * Strictly type-check TypeScript entrypoints through the `mizchi/ts/mtsc`
   * MoonBit JavaScript module, then generate MoonBit bridge packages before
   * starting `moon build`.
   */
  tsBridge?: MoonbitTsBridgeOptions;

  /**
   * Experimental: post-process MoonBit-generated `_build/.../*.d.ts` files with
   * `mizchi/ts.mbt` to emit clearer TypeScript declarations in place.
   * The normalized output shape may still change between releases.
   */
  normalizedDts?: MoonbitNormalizedDtsOptions;

  /**
   * Generate an npm-publishable ESM package from a MoonBit package. The output
   * contains JavaScript, `.d.ts`, and `package.json`, so it can be published
   * without exposing MoonBit-specific build glue.
   */
  npmPackage?: MoonbitNpmPackageOptions;

  /**
   * Import prefix used to identify MoonBit modules. Change this when loading
   * the plugin more than once in a single project to mix multiple backends:
   *
   *     plugins: [
   *       moonbit({ target: "js" }),                       // mbt:foo
   *       moonbit({ target: "wasm-gc", prefix: "mbtw:" }), // mbtw:foo
   *     ]
   *
   * The prefix must end with `":"`.
   *
   * @default "mbt:"
   */
  prefix?: string;
}

export interface MoonbitTsBridgeEntrySpec {
  /**
   * TypeScript / TSX / declaration entrypoint. Resolved relative to the Vite root.
   */
  entry: string;

  /**
   * Runtime module specifier imported by the generated `bridge.js`.
   * Prefer non-relative specifiers like `/src/api/client.ts`, `node:fs`, or a
   * bare package name. Relative specs still work, but they prevent the
   * generator from using some direct `#module("...")` MoonBit externs.
   */
  moduleSpec: string;

  /**
   * Output package directory inside the MoonBit project. Resolved relative to `root`.
   */
  outDir: string;
}

export type MoonbitTsBridgeEntry = string | (Partial<MoonbitTsBridgeEntrySpec> & Pick<MoonbitTsBridgeEntrySpec, "entry">);

export interface MoonbitTsBridgeOptions {
  /**
   * Path to the `mizchi/ts.mbt` checkout. Resolved relative to the Vite root.
   * The plugin builds `src/mtsc` for the JS target and imports its
   * `checkModuleGraph` export directly before generating a bridge.
   */
  generatorRoot: string;

  /**
   * Command used to build the `mtsc` JS module and invoke the generator.
   * @default "moon"
   */
  command?: string;

  /**
   * Emit explicit `validate<Type>(JSValue)` boundary functions for generated
   * structural types. Disabled by default so existing bridge APIs and runtime
   * cost remain unchanged.
   *
   * @default false
   */
  runtimeValidation?: boolean;

  /** Bridge package generation specs. */
  entries: MoonbitTsBridgeEntry[];
}

export interface MoonbitNormalizedDtsOptions {
  /**
   * Optional path to the `mizchi/ts.mbt` checkout. Resolved relative to the
   * Vite root. When omitted, `tsBridge.generatorRoot` is reused if available.
   */
  generatorRoot?: string;

  /**
   * Optional command used to invoke the generator.
   * When omitted, `tsBridge.command` is reused if available.
   *
   * @default "moon"
   */
  command?: string;
}

export interface MoonbitNpmPackageOptions {
  /**
   * MoonBit package name (for example `internal/app`) or a path to its
   * `pkg.generated.mbti`. Package names are resolved from this Vite project's
   * MoonBit workspace.
   */
  entry: string;

  /**
   * Directory that becomes the publishable npm package. Resolved relative to
   * the Vite root.
   */
  outDir: string;

  /**
   * Path to the `mizchi/ts.mbt` checkout. Defaults to `tsBridge.generatorRoot`
   * when that integration is enabled.
   */
  generatorRoot?: string;

  /** Command used for `moon info` and `mbt2ts`. @default "moon" */
  command?: string;

  /**
   * npm package name to write into the generated `package.json`.
   * Defaults to the MoonBit package name derived by `mbt2ts`.
   */
  name?: string;

  /**
   * npm package version to write into the generated `package.json`.
   * Defaults to the version emitted by `mbt2ts`.
   */
  version?: string;

  /**
   * Generate callable wrappers for eligible MoonBit methods and constructors.
   * @default true
   */
  facade?: boolean;

  /** Reject the package when public MoonBit members cannot be autolinked. */
  strict?: boolean;

  /** Optional import-rewrite JSON file for external MoonBit package imports. */
  importRewrites?: string;

  /** Optional path for copied autolink diagnostics. */
  diagnostics?: string;

  /**
   * Bundle MoonBit's generated JS together with local TypeScript bridge
   * modules into the published `index.js`. Disable only when the consumer
   * will provide every runtime import itself.
   * @default true
   */
  bundle?: boolean;
}

interface ResolvedMoonbitTsBridgeEntry {
  entry: string;
  moduleSpec: string;
  outDir: string;
}

interface MtscJsModule {
  checkModuleGraph(graph: MtscModuleGraph): string;
}

interface MtscModuleSource {
  path: string;
  source: string;
  allowJsx: boolean;
}

interface MtscModuleEdge {
  importerPath: string;
  moduleSpecifier: string;
  targetPath: string;
}

interface MtscModuleGraph {
  modules: MtscModuleSource[];
  edges: MtscModuleEdge[];
}

interface TsBridgeModuleSource {
  path: string;
  source: string;
  allowJsx: boolean;
}

interface TsBridgeModuleGraph {
  modules: TsBridgeModuleSource[];
  edges: MtscModuleEdge[];
}

export default function moonbitPlugin(
  options: MoonbitPluginOptions = {}
): Plugin {
  const {
    root = process.cwd(),
    watch: watchOption,
    mode = "release",
    target = "js",
    showLogs = true,
    prefix = "mbt:",
  } = options;
  if (!prefix.endsWith(":")) {
    throw new Error(
      `[vite-plugin-moonbit] "prefix" must end with ":" (got ${JSON.stringify(prefix)})`
    );
  }
  const MBT_PREFIX = prefix;
  const VIRTUAL_MODULE_PREFIX = "\0" + prefix;

  let config: ResolvedConfig;
  let server: ViteDevServer | null = null;
  let moonProcess: ChildProcess | null = null;
  let projectInfo: ProjectInfo | null = null;
  let useJsBuiltinString = options.useJsBuiltinString ?? false;
  let logBuffer: string[] = [];
  let errorBuffer: string[] = [];
  let didGenerateTsBridges = false;
  let didGenerateNpmPackage = false;
  let didNormalizeDtsAtStartup = false;
  let tsBridgeWatcherRegistered = false;
  let npmPackageWatcherRegistered = false;
  let didWarnMissingNormalizedDtsGenerator = false;
  let didLogMissingNormalizedDtsBuildDir = false;
  let didLogMissingNormalizedDtsFiles = false;
  let didLogNormalizedDtsGeneratorInfo = false;
  let mtscJsModule: MtscJsModule | null = null;
  let mtscJsModuleRoot: string | null = null;
  let mtscJsModuleInputStamp: number | null = null;
  const tsBridgeTrackedFiles = new Set<string>();
  const npmPackageWatchRoots = new Set<string>();

  const fileExt = target === "js" ? ".js" : ".wasm";

  function getBuildDir(): string {
    const base = projectInfo?.workspaceRoot ?? root;
    return path.join(base, "_build", target, mode, "build");
  }

  function resolveConfigPath(filepath: string): string {
    if (path.isAbsolute(filepath)) return filepath;
    const base = config?.root ?? root;
    return path.resolve(base, filepath);
  }

  function resolveMoonbitPath(filepath: string): string {
    if (path.isAbsolute(filepath)) return filepath;
    return path.resolve(root, filepath);
  }

  function resolveTsBridgeEntries(): ResolvedMoonbitTsBridgeEntry[] {
    const tsBridge = options.tsBridge;
    if (!tsBridge) return [];
    return tsBridge.entries.map((entrySpec) => {
      const normalized =
        typeof entrySpec === "string" ? { entry: entrySpec } : entrySpec;
      const entry = resolveConfigPath(normalized.entry);
      const relativeEntry = path
        .relative(config?.root ?? root, entry)
        .replace(/\\/g, "/");
      const entryNoPrefix = relativeEntry.startsWith("./")
        ? relativeEntry.slice(2)
        : relativeEntry;
      const moduleSpec =
        normalized.moduleSpec ?? `/${entryNoPrefix.replace(/^\/+/, "")}`;

      let inferredOutDir = "";
      const parsed = path.posix.parse(entryNoPrefix);
      const parts = entryNoPrefix.split("/").filter(Boolean);
      if (parts.length <= 1) {
        inferredOutDir = path.posix.join("gen", `${parsed.name}_bridge`);
      } else {
        inferredOutDir = path.posix.join(parts[0], "gen", `${parsed.name}_bridge`);
      }

      return {
        entry,
        moduleSpec,
        outDir: resolveMoonbitPath(normalized.outDir ?? inferredOutDir),
      };
    });
  }

  function resolveTsBridgeGeneratorRoot(): string | null {
    const tsBridge = options.tsBridge;
    if (!tsBridge) return null;
    return resolveConfigPath(tsBridge.generatorRoot);
  }

  function isTsBridgeSourcePath(filepath: string): boolean {
    return /\.(?:[cm]?tsx?|d\.ts)$/.test(filepath);
  }

  function tsBridgeImportSpecifiers(source: string): string[] {
    const specifiers = new Set<string>();
    const patterns = [
      /\bimport\s+(?:type\s+)?(?:[\w*$\s{},]+?\s+from\s+)?["']([^"']+)["']/g,
      /\bexport\s+(?:type\s+)?(?:[\w*$\s{},]+?\s+from\s+)["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        specifiers.add(match[1]);
      }
    }
    return [...specifiers];
  }

  function isTsBridgeRelativeOrRootSpecifier(specifier: string): boolean {
    return specifier.startsWith(".") || specifier.startsWith("/");
  }

  function cleanResolvedTsBridgePath(filepath: string): string {
    return filepath.replace(/\?.*$/, "");
  }

  function isNodeModulePath(filepath: string): boolean {
    return filepath.split(/[\\/]+/).includes("node_modules");
  }

  function trackTsBridgeFile(filepath: string) {
    tsBridgeTrackedFiles.add(filepath);
    server?.watcher.add(filepath);
  }

  function newestMtimeInDirectory(directory: string): number {
    let newest = 0;
    try {
      newest = fs.statSync(directory).mtimeMs;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filepath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          newest = Math.max(newest, newestMtimeInDirectory(filepath));
        } else if (entry.isFile()) {
          try {
            newest = Math.max(newest, fs.statSync(filepath).mtimeMs);
          } catch {
            // A watcher can observe a file while it is being removed. The
            // directory mtime still invalidates the cached module next run.
          }
        }
      }
    } catch {
      // A deleted generator directory is handled by the subsequent Moon build
      // error, not by cache-stamp collection.
    }
    return newest;
  }

  function mtscInputStamp(generatorRoot: string): number {
    return Math.max(
      newestMtimeInDirectory(path.join(generatorRoot, "src")),
      ...["moon.mod", "moon.mod.json"].map((name) => {
        const filepath = path.join(generatorRoot, name);
        return fs.existsSync(filepath) ? fs.statSync(filepath).mtimeMs : 0;
      }),
    );
  }

  function invalidateMtscJsModule() {
    mtscJsModule = null;
    mtscJsModuleRoot = null;
    mtscJsModuleInputStamp = null;
  }

  function formatTsBridgeDiagnostics(
    diagnostics: string,
    modules: TsBridgeModuleSource[],
  ): string {
    const base = config?.root ?? root;
    let formatted = diagnostics;
    for (const module of modules) {
      formatted = formatted.replaceAll(
        module.path,
        path.relative(base, module.path) || path.basename(module.path),
      );
    }
    return formatted;
  }

  async function collectTsBridgeModuleSources(
    entry: ResolvedMoonbitTsBridgeEntry,
  ): Promise<TsBridgeModuleGraph> {
    const resolver = config.createResolver();
    const modules: TsBridgeModuleSource[] = [];
    const edges: MtscModuleEdge[] = [];
    const queued = [entry.entry];
    const visited = new Set<string>();

    while (queued.length > 0) {
      const next = queued.shift();
      if (!next) continue;
      const filepath = path.resolve(next);
      if (visited.has(filepath)) continue;
      visited.add(filepath);
      trackTsBridgeFile(filepath);

      let source = "";
      try {
        source = fs.readFileSync(filepath, "utf-8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `[moonbit] Could not read TS bridge module ${filepath}\n${message}`,
        );
      }
      modules.push({
        path: filepath,
        source,
        allowJsx: filepath.endsWith(".tsx"),
      });

      for (const specifier of tsBridgeImportSpecifiers(source)) {
        const resolved = await resolver(specifier, filepath);
        if (!resolved) {
          if (isTsBridgeRelativeOrRootSpecifier(specifier)) {
            throw new Error(
              `[moonbit] Could not resolve local TS bridge import ${JSON.stringify(specifier)} from ${filepath}`,
            );
          }
          continue;
        }
        const dependency = cleanResolvedTsBridgePath(resolved);
        if (isTsBridgeSourcePath(dependency) && !isNodeModulePath(dependency)) {
          edges.push({
            importerPath: filepath,
            moduleSpecifier: specifier,
            targetPath: path.resolve(dependency),
          });
          queued.push(dependency);
        }
      }
    }
    return { modules, edges };
  }

  function resolveNormalizedDtsGeneratorRoot(): string | null {
    const normalizedDts = options.normalizedDts;
    if (!normalizedDts) return null;
    if (normalizedDts.generatorRoot) {
      return resolveConfigPath(normalizedDts.generatorRoot);
    }
    const tsBridge = options.tsBridge;
    if (tsBridge?.generatorRoot) {
      return resolveConfigPath(tsBridge.generatorRoot);
    }
    return null;
  }

  function resolveNormalizedDtsCommand(): string {
    const normalizedDts = options.normalizedDts;
    if (!normalizedDts) return "moon";
    if (normalizedDts.command) return normalizedDts.command;
    const tsBridge = options.tsBridge;
    if (tsBridge?.command) return tsBridge.command;
    return "moon";
  }

  function resolveNpmPackageGeneratorRoot(): string | null {
    const npmPackage = options.npmPackage;
    if (!npmPackage) return null;
    if (npmPackage.generatorRoot) {
      return resolveConfigPath(npmPackage.generatorRoot);
    }
    const tsBridge = options.tsBridge;
    if (tsBridge?.generatorRoot) {
      return resolveConfigPath(tsBridge.generatorRoot);
    }
    return null;
  }

  function resolveNpmPackageCommand(): string {
    const npmPackage = options.npmPackage;
    if (npmPackage?.command) return npmPackage.command;
    const tsBridge = options.tsBridge;
    if (tsBridge?.command) return tsBridge.command;
    return "moon";
  }

  function trackNpmPackageWatchRoot(filepath: string) {
    const absolute = path.resolve(filepath);
    npmPackageWatchRoots.add(absolute);
    server?.watcher.add(absolute);
  }

  function resolveNpmPackageMbtiPath(entry: string): string {
    const configuredPath = resolveConfigPath(entry);
    if (entry.endsWith("pkg.generated.mbti")) {
      trackNpmPackageWatchRoot(path.dirname(configuredPath));
      return configuredPath;
    }
    if (fs.existsSync(configuredPath)) {
      const stat = fs.statSync(configuredPath);
      if (stat.isFile()) return configuredPath;
      if (stat.isDirectory()) {
        trackNpmPackageWatchRoot(configuredPath);
        return path.join(configuredPath, "pkg.generated.mbti");
      }
    }

    const packageDir = resolveSourcePackageDir(
      entry.startsWith(MBT_PREFIX) ? entry : `${MBT_PREFIX}${entry}`,
    );
    if (!packageDir) {
      throw new Error(
        `[moonbit] Could not resolve npmPackage.entry ${JSON.stringify(entry)} as a MoonBit package or pkg.generated.mbti path`,
      );
    }
    trackNpmPackageWatchRoot(packageDir);
    return path.join(packageDir, "pkg.generated.mbti");
  }

  function runMoonbitInfoForNpmPackage(command: string, reason: string) {
    const cwd = projectInfo?.workspaceRoot ?? root;
    log(`Generating MoonBit interfaces for npm package (${reason})`);
    const result = spawnSync(command, ["info"], {
      cwd,
      encoding: "utf-8",
    });
    if (result.status === 0) return;
    const details = [
      result.stdout?.trim(),
      result.stderr?.trim(),
      result.error?.message,
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `[moonbit] Could not generate MoonBit interfaces for npm packaging\n${details || `command exited with code ${result.status}`}`,
    );
  }

  function copyNpmBundleFiles(from: string, to: string) {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        copyNpmBundleFiles(source, target);
      } else if (entry.isFile()) {
        fs.copyFileSync(source, target);
      }
    }
  }

  function tsBridgeRuntimeModules(): Map<string, string> {
    const runtimeModules = new Map<string, string>();
    for (const entry of resolveTsBridgeEntries()) {
      const packageJsonPath = path.join(entry.outDir, "package.json");
      const bridgeJsPath = path.join(entry.outDir, "bridge.js");
      if (!fs.existsSync(packageJsonPath) || !fs.existsSync(bridgeJsPath)) {
        continue;
      }
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        if (
          packageJson !== null &&
          typeof packageJson === "object" &&
          typeof packageJson.name === "string" &&
          packageJson.name.length > 0
        ) {
          runtimeModules.set(packageJson.name, bridgeJsPath);
        }
      } catch {
        // The bridge generator owns this manifest. Let its generated import
        // produce Vite's normal diagnostic if it is malformed.
      }
    }
    return runtimeModules;
  }

  function tsBridgeRuntimeResolver(): Plugin | null {
    const runtimeModules = tsBridgeRuntimeModules();
    if (runtimeModules.size === 0) return null;
    return {
      name: "vite-plugin-moonbit:ts-bridge-runtime",
      enforce: "pre",
      resolveId(id) {
        return runtimeModules.get(id) ?? null;
      },
    };
  }

  async function bundleNpmPackage(
    outDir: string,
    entry: string,
  ): Promise<void> {
    const bundleDir = path.join(outDir, ".tsmbt-vite-bundle");
    fs.rmSync(bundleDir, { recursive: true, force: true });
    try {
      const { build } = await import("vite");
      const runtimeResolver = tsBridgeRuntimeResolver();
      await build({
        configFile: false,
        root: config.root,
        logLevel: "error",
        plugins: runtimeResolver ? [runtimeResolver] : [],
        resolve: {
          alias: config.resolve.alias,
        },
        build: {
          lib: {
            entry,
            formats: ["es"],
            fileName: "index",
          },
          outDir: bundleDir,
          emptyOutDir: true,
          sourcemap: true,
          rollupOptions: {
            output: {
              entryFileNames: "index.js",
            },
          },
        },
      });
      if (!fs.existsSync(path.join(bundleDir, "index.js"))) {
        throw new Error("Vite did not emit index.js");
      }
      copyNpmBundleFiles(bundleDir, outDir);
    } finally {
      // This directory is reserved for this generator and always created
      // inside the requested output directory immediately above.
      fs.rmSync(bundleDir, { recursive: true, force: true });
    }
  }

  function applyNpmPackageMetadata(
    outDir: string,
    npmPackage: MoonbitNpmPackageOptions,
  ) {
    if (npmPackage.name === undefined && npmPackage.version === undefined) {
      return;
    }
    const packageJsonPath = path.join(outDir, "package.json");
    let generated: unknown;
    try {
      generated = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    } catch (error) {
      throw new Error(
        `[moonbit] Could not read generated npm package metadata at ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (generated === null || typeof generated !== "object" || Array.isArray(generated)) {
      throw new Error(
        `[moonbit] Generated npm package metadata at ${packageJsonPath} must be a JSON object`,
      );
    }
    const metadata = generated as Record<string, unknown>;
    for (const [field, value] of [
      ["name", npmPackage.name],
      ["version", npmPackage.version],
    ] as const) {
      if (value !== undefined) {
        if (value.trim() === "") {
          throw new Error(`[moonbit] npmPackage.${field} must not be empty`);
        }
        metadata[field] = value;
      }
    }
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(metadata, null, 2)}\n`);
  }

  async function runNpmPackageGeneration(reason: string): Promise<boolean> {
    const npmPackage = options.npmPackage;
    if (!npmPackage) return false;
    const generatorRoot = resolveNpmPackageGeneratorRoot();
    if (!generatorRoot) {
      throw new Error(
        "[moonbit] npmPackage is enabled but no generatorRoot is configured. Set npmPackage.generatorRoot or reuse tsBridge.generatorRoot.",
      );
    }
    const command = resolveNpmPackageCommand();
    runMoonbitInfoForNpmPackage(command, reason);
    const mbtiPath = resolveNpmPackageMbtiPath(npmPackage.entry);
    if (!fs.existsSync(mbtiPath)) {
      throw new Error(
        `[moonbit] npmPackage.entry did not produce ${mbtiPath}. Ensure moon info can generate pkg.generated.mbti for the selected package.`,
      );
    }
    const outDir = resolveConfigPath(npmPackage.outDir);
    const args = [
      "run",
      "src/cmd/mbt2ts",
      "--",
      "--input",
      mbtiPath,
      "--out",
      outDir,
    ];
    if (npmPackage.facade === false) args.push("--no-facade");
    if (npmPackage.strict) args.push("--strict");
    if (npmPackage.importRewrites) {
      args.push("--import-rewrites", resolveConfigPath(npmPackage.importRewrites));
    }
    if (npmPackage.diagnostics) {
      args.push("--diagnostics", resolveConfigPath(npmPackage.diagnostics));
    }
    log(
      `Generating npm package (${reason}): ${path.relative(config?.root ?? root, outDir)} <- ${npmPackage.entry}`,
    );
    const result = spawnSync(command, args, {
      cwd: generatorRoot,
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      const details = [result.stdout?.trim(), result.stderr?.trim()]
        .filter(Boolean)
        .join("\n");
      throw new Error(
        `[moonbit] npm package generation failed for ${npmPackage.entry}\n${details || `command exited with code ${result.status}`}`,
      );
    }
    if (showLogs && result.stdout?.trim()) {
      console.log(result.stdout.trim());
    }
    applyNpmPackageMetadata(outDir, npmPackage);
    if (npmPackage.bundle !== false) {
      log(`Bundling npm package runtime (${reason}): ${path.relative(config?.root ?? root, outDir)}`);
      await bundleNpmPackage(outDir, path.join(outDir, "index.js"));
    }
    return true;
  }

  async function ensureNpmPackageGeneration(reason: string) {
    if (!options.npmPackage) return;
    await runNpmPackageGeneration(reason);
    didGenerateNpmPackage = true;
  }

  function isNpmPackageSourcePath(filepath: string): boolean {
    const name = path.basename(filepath);
    return filepath.endsWith(".mbt") ||
      name === "moon.pkg" ||
      name === "moon.pkg.json" ||
      name === "moon.mod" ||
      name === "moon.mod.json";
  }

  function isMoonbitGeneratedDeclarationFile(filepath: string): boolean {
    return (
      filepath.endsWith(".d.ts") ||
      filepath.endsWith(".d.mts") ||
      filepath.endsWith(".d.cts")
    );
  }

  function collectBuildDeclarationFiles(dir: string): string[] {
    const files: string[] = [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectBuildDeclarationFiles(full));
        continue;
      }
      if (!isMoonbitGeneratedDeclarationFile(full)) continue;
      if (entry.name === "moonbit.d.ts" || entry.name === "moonbit.d.mts" || entry.name === "moonbit.d.cts") {
        continue;
      }
      files.push(full);
    }
    return files;
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

  /**
   * Reverse of resolveCandidates: given an absolute `<buildDir>/.../<x>.js`
   * path, figure out which `mbt:<member>/...` id produces it. Used by the
   * build watcher to know exactly which virtual module changed.
   *
   * Moon's layout choice is deterministic: multi-root (nested under the
   * module name) when the workspace has 2+ members, otherwise flat.
   */
  function buildOutputToMbtId(filepath: string): string | null {
    if (!projectInfo) return null;
    const buildDir = getBuildDir();
    const abs = path.resolve(filepath);
    if (abs !== buildDir && !abs.startsWith(buildDir + path.sep)) return null;
    let rel = path.relative(buildDir, abs);
    if (!rel.endsWith(fileExt)) return null;
    rel = rel.slice(0, -fileExt.length);
    const parts = rel.split(path.sep).filter(Boolean);
    if (parts.length === 0) return null;

    const useNested =
      projectInfo.isWorkspace && projectInfo.members.length > 1;

    const tryMatch = (tail: string[], member: Member): string | null => {
      if (tail.length === 0) return null;
      const nameSegs = member.name.split("/");
      const shortAlias = tail[tail.length - 1];
      const pkgSegs = tail.slice(0, -1);
      const expected =
        pkgSegs.length > 0
          ? pkgSegs[pkgSegs.length - 1]
          : nameSegs[nameSegs.length - 1];
      if (shortAlias !== expected) return null;
      const id =
        pkgSegs.length > 0
          ? member.name + "/" + pkgSegs.join("/")
          : member.name;
      return MBT_PREFIX + id;
    };

    for (const member of projectInfo.members) {
      const nameSegs = member.name.split("/");
      if (useNested) {
        if (
          parts.length > nameSegs.length &&
          parts.slice(0, nameSegs.length).join("/") === member.name
        ) {
          const id = tryMatch(parts.slice(nameSegs.length), member);
          if (id) return id;
        }
      } else {
        const id = tryMatch(parts, member);
        if (id) return id;
      }
    }
    return null;
  }

  function resolveModulePath(id: string): string | null {
    const candidates = resolveCandidates(id);
    if (candidates.length === 0) return null;
    // Return the first existing candidate, else the first candidate as the
    // reported path for the "could not resolve" error message.
    return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
  }

  /**
   * Walk each member's source tree and return true if any `moon.pkg(.json)`
   * has `link.wasm-gc.use-js-builtin-string: true`.
   */
  function detectJsBuiltinString(info: ProjectInfo): boolean {
    const walk = (dir: string): boolean => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return false;
      }
      for (const entry of entries) {
        if (entry.name === "_build" || entry.name === ".mooncakes") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (walk(full)) return true;
        } else if (
          entry.name === "moon.pkg.json" ||
          entry.name === "moon.pkg"
        ) {
          const parsed = readMoonManifest(full);
          const wg = (parsed?.link as Record<string, unknown> | undefined)?.[
            "wasm-gc"
          ] as Record<string, unknown> | undefined;
          if (wg && wg["use-js-builtin-string"] === true) return true;
        }
      }
      return false;
    };
    for (const m of info.members) {
      if (walk(path.join(m.memberDir, m.source))) return true;
    }
    return false;
  }

  function resolveSourcePackageDir(id: string): string | null {
    if (!projectInfo) return null;
    const parts = id.slice(MBT_PREFIX.length).split("/");
    const member = matchMember(parts);
    if (!member) return null;
    const pkgParts = parts.slice(member.name.split("/").length);
    return path.join(member.memberDir, member.source, ...pkgParts);
  }

  function resolveSourceBridgeModule(id: string): string | null {
    const pkgDir = resolveSourcePackageDir(id);
    if (!pkgDir) return null;
    const bridgeJs = path.join(pkgDir, "bridge.js");
    const bridgeMbt = path.join(pkgDir, "bridge.mbt");
    if (fs.existsSync(bridgeJs) && fs.existsSync(bridgeMbt)) {
      return bridgeJs;
    }
    return null;
  }

  function readPkgImports(id: string): string[] {
    const pkgDir = resolveSourcePackageDir(id);
    if (!pkgDir) return [];
    const parsed = readPkgManifest(pkgDir);
    if (!parsed || !Array.isArray(parsed.import)) return [];
    return parsed.import.filter((item): item is string => typeof item === "string");
  }

  function collectSourceBridgeModules(
    id: string,
    seen = new Set<string>()
  ): string[] {
    if (seen.has(id)) return [];
    seen.add(id);

    const modules: string[] = [];
    const selfBridge = resolveSourceBridgeModule(id);
    if (selfBridge) modules.push(selfBridge);

    for (const imported of readPkgImports(id)) {
      const importedId = MBT_PREFIX + imported;
      for (const bridgeModule of collectSourceBridgeModules(importedId, seen)) {
        if (!modules.includes(bridgeModule)) {
          modules.push(bridgeModule);
        }
      }
    }
    return modules;
  }

  function readBridgeBindingNames(bridgeModule: string): string[] {
    let content = "";
    try {
      content = fs.readFileSync(bridgeModule, "utf-8");
    } catch {
      return [];
    }
    const names = new Set<string>();
    const constRe = /^export const ([A-Za-z_$][\w$]*)\s*=/gm;
    const fnRe = /^export function ([A-Za-z_$][\w$]*)\s*\(/gm;
    let match: RegExpExecArray | null;
    while ((match = constRe.exec(content))) {
      names.add(match[1]);
    }
    while ((match = fnRe.exec(content))) {
      names.add(match[1]);
    }
    const reexportRe = /^export\s*\{\s*([^}]+)\s*\}\s*from\s*["'][^"']+["'];?/gm;
    while ((match = reexportRe.exec(content))) {
      const specifiers = match[1].split(",");
      for (const specifier of specifiers) {
        const normalized = specifier.trim().replace(/\s+/g, " ");
        if (!normalized) continue;
        const asMatch = normalized.match(
          /^(?:default|[A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/,
        );
        if (asMatch) {
          names.add(asMatch[1]);
          continue;
        }
        const plainMatch = normalized.match(/^([A-Za-z_$][\w$]*)$/);
        if (plainMatch) {
          names.add(plainMatch[1]);
        }
      }
    }
    return [...names];
  }

  function renderBridgeImportPrelude(id: string): string {
    const bridgeModules = collectSourceBridgeModules(id);
    if (bridgeModules.length === 0) return "";
    const lines: string[] = [];
    for (const bridgeModule of bridgeModules) {
      const bindingNames = readBridgeBindingNames(bridgeModule);
      if (bindingNames.length === 0) continue;
      const relativeBridge = path
        .relative(config.root, bridgeModule)
        .replace(/\\/g, "/");
      lines.push(
        `import { ${bindingNames.join(", ")} } from "/${relativeBridge}";`
      );
    }
    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
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
    const parsed = readPkgManifest(pkgDir);
    if (!parsed) return null;
    if (parsed.virtual) {
      return `${id} is a virtual package (declared in ${path.relative(root, pkgDir)}). Virtual packages have no runtime output — import the app/main package that selects an implementation via \`overrides\` instead.`;
    }
    if (typeof parsed.implement === "string") {
      return `${id} is an implementation of \`${parsed.implement}\` (declared in ${path.relative(root, pkgDir)}). Implementations are linked by the app that declares \`overrides\` and do not produce a standalone .js.`;
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

  interface MoonDiagnostic {
    level: "warning" | "error";
    error_code: number;
    path: string;
    loc: string; // "<startLine>:<startCol>-<endLine>:<endCol>"
    message: string;
  }

  let cycleDiagnostics: MoonDiagnostic[] = [];

  function tryParseDiagnostic(line: string): MoonDiagnostic | null {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('{"$message_type"')) return null;
    try {
      const obj = JSON.parse(trimmed) as {
        $message_type?: string;
        level?: string;
        error_code?: number;
        path?: string;
        loc?: string;
        message?: string;
      };
      if (
        obj.$message_type !== "diagnostic" ||
        (obj.level !== "warning" && obj.level !== "error") ||
        typeof obj.path !== "string" ||
        typeof obj.loc !== "string" ||
        typeof obj.message !== "string"
      ) {
        return null;
      }
      return {
        level: obj.level,
        error_code: obj.error_code ?? 0,
        path: obj.path,
        loc: obj.loc,
        message: obj.message,
      };
    } catch {
      return null;
    }
  }

  function parseLocStart(loc: string): { line: number; column: number } {
    // Format: "sLine:sCol-eLine:eCol". Fall back to 1:1 on parse failure.
    const m = loc.match(/^(\d+):(\d+)/);
    return m
      ? { line: Number(m[1]), column: Number(m[2]) }
      : { line: 1, column: 1 };
  }

  /**
   * Push accumulated diagnostics to Vite's error overlay (on failure) or
   * clear it (on success). Called once per moon build cycle.
   */
  function commitDiagnostics(success: boolean) {
    if (!server) {
      cycleDiagnostics = [];
      return;
    }
    const errors = cycleDiagnostics.filter((d) => d.level === "error");
    cycleDiagnostics = [];

    if (success || errors.length === 0) {
      // Clear the overlay by sending an empty update batch; Vite's client
      // will dismiss any existing error when it processes a fresh signal.
      server.ws.send({ type: "update", updates: [] });
      return;
    }

    const head = errors[0];
    const loc = parseLocStart(head.loc);
    const summary = errors
      .map((e) => `[${e.error_code}] ${e.path}:${e.loc}\n  ${e.message}`)
      .join("\n\n");

    server.ws.send({
      type: "error",
      err: {
        message: `MoonBit build failed with ${errors.length} error(s):\n\n${summary}`,
        stack: "",
        plugin: "vite-plugin-moonbit",
        id: head.path,
        loc: { file: head.path, line: loc.line, column: loc.column },
      },
    });
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

  async function loadMtscJsModule(
    generatorRoot: string,
    command: string,
  ): Promise<MtscJsModule> {
    const inputStamp = mtscInputStamp(generatorRoot);
    if (
      mtscJsModule &&
      mtscJsModuleRoot === generatorRoot &&
      mtscJsModuleInputStamp === inputStamp
    ) {
      return mtscJsModule;
    }

    log("Building the mtsc MoonBit JS module");
    const buildResult = spawnSync(
      command,
      ["build", "--target", "js", "--release", "src/mtsc"],
      {
        cwd: generatorRoot,
        encoding: "utf-8",
      },
    );
    if (buildResult.status !== 0) {
      const details = [
        buildResult.stdout?.trim(),
        buildResult.stderr?.trim(),
        buildResult.error?.message,
      ]
        .filter(Boolean)
        .join("\n");
      throw new Error(
        `[moonbit] Could not build the mtsc MoonBit JS module\n${details || `command exited with code ${buildResult.status}`}`,
      );
    }

    const modulePath = path.join(
      generatorRoot,
      "_build",
      "js",
      "release",
      "build",
      "mtsc",
      "mtsc.js",
    );
    if (!fs.existsSync(modulePath)) {
      throw new Error(
        `[moonbit] mtsc MoonBit JS module was not emitted at ${modulePath}`,
      );
    }

    const artifactStamp = fs.statSync(modulePath).mtimeMs;
    const imported: unknown = await import(
      `${pathToFileURL(modulePath).href}?v=${artifactStamp}`,
    );
    const checkModuleGraph = (
      imported as { checkModuleGraph?: unknown }
    ).checkModuleGraph;
    if (typeof checkModuleGraph !== "function") {
      throw new Error(
        `[moonbit] mtsc MoonBit JS module does not export checkModuleGraph (${modulePath})`,
      );
    }

    mtscJsModule = {
      checkModuleGraph: checkModuleGraph as MtscJsModule["checkModuleGraph"],
    };
    mtscJsModuleRoot = generatorRoot;
    mtscJsModuleInputStamp = inputStamp;
    return mtscJsModule;
  }

  async function runTsBridgeGeneration(reason: string) {
    const tsBridge = options.tsBridge;
    if (!tsBridge) return;
    const generatorRoot = resolveTsBridgeGeneratorRoot();
    if (!generatorRoot) return;
    const entries = resolveTsBridgeEntries();
    if (entries.length === 0) return;

    const command = tsBridge.command ?? "moon";
    const checker = await loadMtscJsModule(generatorRoot, command);
    for (const entry of entries) {
      log(
        `Type-checking TS bridge entry (${reason}): ${path.relative(config?.root ?? root, entry.entry)}`,
      );
      const graph = await collectTsBridgeModuleSources(entry);
      const diagnostics = checker.checkModuleGraph({
        modules: graph.modules.map(({ path: filepath, source, allowJsx }) => ({
          path: filepath,
          source,
          allowJsx,
        })),
        edges: graph.edges,
      });
      if (diagnostics) {
        const formattedDiagnostics = formatTsBridgeDiagnostics(
          diagnostics,
          graph.modules,
        );
        throw new Error(
          `[moonbit] Type checking TS bridge entry failed for ${entry.entry}\n${formattedDiagnostics}`,
        );
      }

      const args = [
        "run",
        "src/cmd/ts2mbt",
        "--",
        tsBridge.runtimeValidation ? "package-validated" : "package",
        entry.entry,
        entry.moduleSpec,
        entry.outDir,
      ];
      log(
        `Generating TS bridge package (${reason}): ${path.relative(root, entry.outDir)} <- ${path.relative(config?.root ?? root, entry.entry)}`
      );
      const result = spawnSync(command, args, {
        cwd: generatorRoot,
        encoding: "utf-8",
      });
      if (result.status !== 0) {
        const stdout = result.stdout?.trim();
        const stderr = result.stderr?.trim();
        const details = [stdout, stderr].filter(Boolean).join("\n");
        throw new Error(
          `[moonbit] TS bridge generation failed for ${entry.entry}\n${details || `command exited with code ${result.status}`}`
        );
      }
      if (showLogs && result.stdout?.trim()) {
        console.log(result.stdout.trim());
      }
    }
    didGenerateTsBridges = true;
  }

  async function ensureTsBridgeGeneration(reason: string) {
    if (!options.tsBridge) return;
    await runTsBridgeGeneration(reason);
  }

  function runNormalizedDtsGeneration(reason: string): boolean {
    const normalizedDts = options.normalizedDts;
    if (!normalizedDts) return false;
    const generatorRoot = resolveNormalizedDtsGeneratorRoot();
    if (!generatorRoot) {
      if (!didWarnMissingNormalizedDtsGenerator) {
        log(
          "normalizedDts is enabled but no generatorRoot is configured. Set normalizedDts.generatorRoot or reuse tsBridge.generatorRoot.",
          "warn",
        );
        didWarnMissingNormalizedDtsGenerator = true;
      }
      return false;
    }
    const buildDir = getBuildDir();
    if (!fs.existsSync(buildDir)) {
      if (!didLogMissingNormalizedDtsBuildDir) {
        log(
          `Skipping normalized .d.ts generation (${reason}): build directory does not exist yet (${path.relative(root, buildDir)})`
        );
        didLogMissingNormalizedDtsBuildDir = true;
      }
      return false;
    }
    const declarationFiles = collectBuildDeclarationFiles(buildDir);
    if (declarationFiles.length === 0) {
      if (!didLogMissingNormalizedDtsFiles) {
        log(
          `Skipping normalized .d.ts generation (${reason}): no declaration files found under ${path.relative(root, buildDir)}`
        );
        didLogMissingNormalizedDtsFiles = true;
      }
      return false;
    }

    didLogMissingNormalizedDtsBuildDir = false;
    didLogMissingNormalizedDtsFiles = false;
    const command = resolveNormalizedDtsCommand();
    if (!didLogNormalizedDtsGeneratorInfo) {
      log(
        `normalizedDts will use generatorRoot ${generatorRoot} (command: ${command})`
      );
      didLogNormalizedDtsGeneratorInfo = true;
    }
    log(
      `Normalizing MoonBit declarations (${reason}): ${declarationFiles.length} file(s)`
    );
    for (const filepath of declarationFiles) {
      const args = [
        "run",
        "src/cmd/mbt2ts",
        "--",
        "normalize",
        filepath,
        filepath,
      ];
      const result = spawnSync(command, args, {
        cwd: generatorRoot,
        encoding: "utf-8",
      });
      if (result.status !== 0) {
        const stdout = result.stdout?.trim();
        const stderr = result.stderr?.trim();
        const details = [stdout, stderr].filter(Boolean).join("\n");
        throw new Error(
          `[moonbit] .d.ts normalization failed for ${filepath}\n${details || `command exited with code ${result.status}`}`
        );
      }
      if (showLogs && result.stdout?.trim()) {
        console.log(result.stdout.trim());
      }
    }
    return true;
  }

  function ensureNormalizedDtsGeneration(reason: string): boolean {
    if (!options.normalizedDts) return false;
    return runNormalizedDtsGeneration(reason);
  }

  function registerTsBridgeWatcher(devServer: ViteDevServer) {
    if (!options.tsBridge || tsBridgeWatcherRegistered) return;
    for (const filepath of tsBridgeTrackedFiles) {
      devServer.watcher.add(filepath);
    }
    const generatorRoot = resolveTsBridgeGeneratorRoot();
    const generatorSourceDir = generatorRoot
      ? path.join(generatorRoot, "src")
      : null;
    const generatorManifestPaths = generatorRoot
      ? ["moon.mod", "moon.mod.json"].map((name) => path.join(generatorRoot, name))
      : [];
    if (generatorSourceDir) {
      devServer.watcher.add(generatorSourceDir);
    }
    if (generatorManifestPaths.length > 0) {
      devServer.watcher.add(generatorManifestPaths);
    }
    devServer.watcher.on("all", (event, changedPath) => {
      if (event !== "add" && event !== "change" && event !== "unlink") return;
      const abs = path.resolve(changedPath);
      const isMtscInput =
        (generatorSourceDir !== null &&
          (abs === generatorSourceDir ||
            abs.startsWith(generatorSourceDir + path.sep))) ||
        generatorManifestPaths.includes(abs);
      if (isMtscInput) {
        invalidateMtscJsModule();
        void ensureTsBridgeGeneration(
          `mtsc-input-${event}:${path.relative(generatorRoot!, abs)}`,
        ).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          log(message, "error");
        });
        return;
      }
      if (!tsBridgeTrackedFiles.has(abs)) return;
      void ensureTsBridgeGeneration(
        `change:${path.relative(config.root, abs)}`,
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log(message, "error");
      });
    });
    tsBridgeWatcherRegistered = true;
  }

  function registerNpmPackageWatcher(devServer: ViteDevServer) {
    if (!options.npmPackage || npmPackageWatcherRegistered) return;
    for (const rootPath of npmPackageWatchRoots) {
      devServer.watcher.add(rootPath);
    }
    devServer.watcher.on("all", (event, changedPath) => {
      if (event !== "add" && event !== "change" && event !== "unlink") return;
      const absolute = path.resolve(changedPath);
      const belongsToNpmPackage = [...npmPackageWatchRoots].some(
        (rootPath) =>
          absolute === rootPath || absolute.startsWith(rootPath + path.sep),
      );
      if (!belongsToNpmPackage || !isNpmPackageSourcePath(absolute)) return;
      didGenerateNpmPackage = false;
      void Promise.resolve()
        .then(() => ensureNpmPackageGeneration(`change:${path.relative(config.root, absolute)}`))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          log(message, "error");
        });
    });
    npmPackageWatcherRegistered = true;
  }

  function startWatchProcess() {
    if (moonProcess) return;

    const cwd = projectInfo?.workspaceRoot ?? root;
    const args = ["build", "--target", target, "--watch", "--output-json"];
    // moon defaults to debug; pass --release when the plugin is in release mode
    // so the watch output lands where the resolver looks.
    if (mode === "release") args.push("--release");

    log(`Starting moon ${args.join(" ")} (cwd=${cwd})...`);
    moonProcess = spawn("moon", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "1" }, // Force ANSI colors
    });

    // stdout and stderr `data` events are chunked arbitrarily; keep a
    // per-stream partial-line buffer so we only parse complete
    // newline-terminated records (JSON diagnostics must not be split).
    let stdoutBuf = "";
    const handleStdoutLine = (line: string) => {
      if (!line.trim()) return;

      // Collect JSON diagnostics emitted by `--output-json` and surface
      // them in the Vite error overlay.
      const diag = tryParseDiagnostic(line);
      if (diag) {
        cycleDiagnostics.push(diag);
        log(`${diag.level} ${diag.path}:${diag.loc}: ${diag.message}`);
        return;
      }

      // Detect build start (file watching)
      if (line.includes("Watching")) {
        clearErrorBuffer();
        cycleDiagnostics = [];
      }

      log(line);

      // Detect build completion
      if (
        line.includes("Finished") ||
        line.includes("Build completed") ||
        line.includes("moon: ran")
      ) {
        clearErrorBuffer();
        try {
          ensureNormalizedDtsGeneration("watch");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(message, "error");
        }
        printBuildSuccess();
        commitDiagnostics(true);
        triggerHMR();
      } else if (line.includes("Had errors, waiting")) {
        commitDiagnostics(false);
      }
    };

    moonProcess.stdout?.on("data", (data: Buffer) => {
      stdoutBuf += data.toString();
      let nl;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        handleStdoutLine(line);
      }
    });

    let stderrBuf = "";
    moonProcess.stderr?.on("data", (data: Buffer) => {
      stderrBuf += data.toString();
      let nl;
      while ((nl = stderrBuf.indexOf("\n")) !== -1) {
        const line = stderrBuf.slice(0, nl);
        stderrBuf = stderrBuf.slice(nl + 1);
        if (!line) continue;
        // Print header on first error in this session
        if (errorBuffer.length === 0) {
          console.log("\n\x1b[1;31m--- MoonBit Build Errors ---\x1b[0m\n");
        }
        errorBuffer.push(line);
        process.stderr.write(line + "\n");
      }
    });

    const flushStreamsOnClose = () => {
      if (stdoutBuf) {
        handleStdoutLine(stdoutBuf);
        stdoutBuf = "";
      }
      if (stderrBuf) {
        errorBuffer.push(stderrBuf);
        process.stderr.write(stderrBuf + "\n");
        stderrBuf = "";
      }
    };

    moonProcess.on("close", (code) => {
      flushStreamsOnClose();
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

  // Changed build outputs accumulate here between moon build cycles. We flush
  // only when moon reports "Finished" / "Build completed" via its stdout, to
  // avoid pushing partially-updated artifacts during rebuilds that take
  // longer than the fs.watch emit cadence.
  const pendingChanges = new Set<string>();

  function queueChange(filepath: string) {
    pendingChanges.add(filepath);
  }

  function flushHMR(changed: string[]) {
    if (!server) return;

    const ids = new Set<string>();
    for (const f of changed) {
      const id = buildOutputToMbtId(f);
      if (id) ids.add(id);
    }

    // Fallback: no individual change info (e.g. first build, or files we
    // couldn't map). Invalidate all known mbt: modules and full-reload.
    if (ids.size === 0) {
      const all = [...server.moduleGraph.idToModuleMap.entries()].filter(
        ([id]) => id.startsWith(VIRTUAL_MODULE_PREFIX)
      );
      if (all.length === 0) return;
      for (const [, mod] of all) server.moduleGraph.invalidateModule(mod);
      log(`HMR fallback: invalidated ${all.length} module(s), full-reload`);
      server.ws.send({ type: "full-reload", path: "*" });
      return;
    }

    let reloaded = 0;
    for (const id of ids) {
      const virtualId = VIRTUAL_MODULE_PREFIX + id.slice(MBT_PREFIX.length);
      const mod = server.moduleGraph.getModuleById(virtualId);
      if (mod) {
        server.reloadModule(mod);
        reloaded++;
      }
    }
    if (reloaded > 0) {
      log(`HMR: updated ${reloaded} module(s) (${Array.from(ids).join(", ")})`);
    } else {
      // The moon build changed files, but no Vite module has been loaded
      // for them yet (e.g. dev server just started). Nothing to propagate.
    }
  }

  function triggerHMR() {
    // Called when moon signals a completed rebuild. Drain whatever fs.watch
    // has accumulated since the previous cycle.
    const batch = Array.from(pendingChanges);
    pendingChanges.clear();
    flushHMR(batch);
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
          if (!filename || !filename.endsWith(fileExt)) return;
          // Clear errors on successful rebuild
          clearErrorBuffer();
          queueChange(path.join(buildDir, filename));
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
    // Use the (prefix, target) pair so multiple instances in one project
    // don't clash in Vite's plugin-de-dup diagnostics.
    name: `vite-plugin-moonbit:${MBT_PREFIX.slice(0, -1)}:${target}`,
    enforce: "pre",

    config() {
      return {
        optimizeDeps: {
          // Exclude our prefix from dependency pre-bundling
          exclude: [`${MBT_PREFIX}*`],
        },
        resolve: {
          // Allow mbt: as external prefix
          external: [],
        },
      };
    },

    async configResolved(resolvedConfig) {
      config = resolvedConfig;
      projectInfo = readProjectInfo(root);

      if (!projectInfo) {
        console.warn(
          "[moonbit] Could not find moon.work, moon.work.json, moon.mod, or moon.mod.json starting from",
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

      if (
        options.useJsBuiltinString === undefined &&
        target === "wasm-gc" &&
        projectInfo &&
        detectJsBuiltinString(projectInfo)
      ) {
        useJsBuiltinString = true;
        log(
          "auto-enabled useJsBuiltinString (detected link.wasm-gc.use-js-builtin-string in a member package)"
        );
      }

      await ensureTsBridgeGeneration("configResolved");
      if (config.command !== "build") {
        await ensureNpmPackageGeneration("configResolved");
      }
      didNormalizeDtsAtStartup = ensureNormalizedDtsGeneration("configResolved");
    },

    configureServer(devServer) {
      server = devServer;
      registerTsBridgeWatcher(devServer);
      registerNpmPackageWatcher(devServer);

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
      const bridgeRuntime = tsBridgeRuntimeModules().get(id);
      if (bridgeRuntime) return bridgeRuntime;
      if (!id.startsWith(MBT_PREFIX)) return null;

      // Pass the query through (e.g. `?worker`, `?url`, `?raw`) — the caller
      // gets back an id with the same query so Vite's built-in handlers can
      // apply after we've resolved the bare path.
      const qIdx = id.indexOf("?");
      const bareId = qIdx >= 0 ? id.slice(0, qIdx) : id;
      const query = qIdx >= 0 ? id.slice(qIdx) : "";
      const resolved = resolveModulePath(bareId);
      if (resolved && fs.existsSync(resolved)) {
        if (target === "js" && /[?&](worker|url|raw)\b/.test(query)) {
          // Route through Vite's built-in handlers by pointing at the real file.
          return resolved + query;
        }
        return VIRTUAL_MODULE_PREFIX + bareId.slice(MBT_PREFIX.length) + query;
      }

      // Show errors with preserved colors when module resolution fails
      if (errorBuffer.length > 0) {
        printErrorBuffer();
      }

      console.error(
        `\x1b[31m[moonbit] Could not resolve: ${id} -> ${resolved || "unknown"}\x1b[0m`
      );
      const hint = overrideHint(bareId);
      if (hint) console.error(`\x1b[33m[moonbit] hint: ${hint}\x1b[0m`);
      return null;
    },

    load(id) {
      if (id.startsWith(VIRTUAL_MODULE_PREFIX)) {
        const qIdx = id.indexOf("?");
        const bare = qIdx >= 0 ? id.slice(0, qIdx) : id;
        const modulePath = bare.slice(VIRTUAL_MODULE_PREFIX.length);
        const fullId = MBT_PREFIX + modulePath;
        const resolved = resolveModulePath(fullId);

        if (resolved && fs.existsSync(resolved)) {
          if (target === "js") {
            // JS backend: return the JS file content directly, together with
            // moon's source map (if present) so .mbt source is debuggable in
            // browser devtools.
            let code = fs.readFileSync(resolved, "utf-8");
            const bridgeImportPrelude = renderBridgeImportPrelude(fullId);
            if (bridgeImportPrelude) code = `${bridgeImportPrelude}${code}`;
            const mapPath = resolved + ".map";
            if (!bridgeImportPrelude && fs.existsSync(mapPath)) {
              try {
                const map = JSON.parse(fs.readFileSync(mapPath, "utf-8"));
                return { code, map };
              } catch {
                /* fall through without map */
              }
            }
            return code;
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

    async buildStart() {
      if (!projectInfo) {
        projectInfo = readProjectInfo(root);
      }
      if (!didGenerateTsBridges) {
        await ensureTsBridgeGeneration("buildStart");
      }
      if (config.command !== "build" && !didGenerateNpmPackage) {
        await ensureNpmPackageGeneration("buildStart");
      }
      if (!didNormalizeDtsAtStartup) {
        didNormalizeDtsAtStartup = ensureNormalizedDtsGeneration("buildStart");
      }
    },

    buildEnd() {
      stopWatchProcess();
      stopBuildWatcher();
    },

    async closeBundle() {
      // Vite clears its output directory after `configResolved` / `buildStart`.
      // Emit here so `npmPackage.outDir: "dist/npm"` is a valid, convenient
      // publication layout rather than being removed by Vite's own build.
      if (config.command === "build" && options.npmPackage) {
        didGenerateNpmPackage = false;
        await ensureNpmPackageGeneration("closeBundle");
      }
    },
  };
}

export { moonbitPlugin as moonbit };
