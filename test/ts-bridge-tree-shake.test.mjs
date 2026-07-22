import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const exampleDir = path.join(repoRoot, "examples", "ts_bridge_project");
const exampleNodeModulesDir = path.join(exampleDir, "node_modules");
const exampleDistDir = path.join(exampleDir, "dist");
const generatedBridgeDir = path.join(exampleDir, "src", "gen", "math_bridge");

function run(cmd, args, cwd) {
  return runWithEnv(cmd, args, cwd, process.env);
}

function runWithEnv(cmd, args, cwd, env) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${cmd} ${args.join(" ")}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  return result;
}

function ensureExampleNodeModules() {
  fs.mkdirSync(exampleNodeModulesDir, { recursive: true });

  const viteLink = path.join(exampleNodeModulesDir, "vite");
  if (!fs.existsSync(viteLink)) {
    fs.symlinkSync(
      path.join(repoRoot, "node_modules", "vite"),
      viteLink,
      "dir",
    );
  }

  const pluginLink = path.join(exampleNodeModulesDir, "vite-plugin-moonbit");
  if (!fs.existsSync(pluginLink)) {
    fs.symlinkSync(repoRoot, pluginLink, "dir");
  }
}

function readExampleBundle() {
  const assetsDir = path.join(exampleDistDir, "assets");
  const entries = fs
    .readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js"))
    .sort();
  assert.equal(entries.length, 1, "expected a single JS bundle");
  return fs.readFileSync(path.join(assetsDir, entries[0]), "utf-8");
}

function createFakeTsBridgeGenerator(diagnostics = "", withSpaceInPath = false) {
  const root = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      withSpaceInPath
        ? "vite plugin-moonbit-ts-bridge-"
        : "vite-plugin-moonbit-ts-bridge-",
    ),
  );
  const logPath = path.join(root, "args.log");
  const commandPath = path.join(root, "fake-moon");
  fs.writeFileSync(path.join(root, "moon.mod.json"), "{}\n");
  const checkerPath = path.join(
    root,
    "_build",
    "js",
    "release",
    "build",
    "mtsc",
    "mtsc.js",
  );
  fs.mkdirSync(path.dirname(checkerPath), { recursive: true });
  fs.writeFileSync(
    checkerPath,
    `import { appendFileSync } from "node:fs";
export function checkModuleGraph(graph) {
  appendFileSync(
    ${JSON.stringify(logPath)},
    \`checkGraph:\${graph.modules.map((module) => \`\${module.path}?\${module.allowJsx}\`).join(",")}|\${graph.edges.map((edge) => \`\${edge.importerPath}=>\${edge.moduleSpecifier}=>\${edge.targetPath}\`).join(",")}\\n\`,
  );
  return ${JSON.stringify(diagnostics)};
}
`,
  );
  fs.writeFileSync(
    commandPath,
    `#!/bin/sh
printf '%s\n' "$*" >> "${logPath}"
exit 0
`,
    { mode: 0o755 },
  );
  return { root, logPath, commandPath };
}

function makeNpmEmittingFakeCommand(fakeGenerator) {
  const runtimeSource = [
    'import { scalePoint } from "/src/api/math.ts";',
    "export { scalePoint };",
    "",
  ].join("\n");
  const declarationSource =
    "export interface Point { x: number; y: number; }\nexport function scalePoint(x: number, y: number, factor: number): Point;\n";
  const packageSource = JSON.stringify({
    name: "@internal/app",
    version: "0.0.0",
    type: "module",
    main: "./index.js",
    types: "./index.d.ts",
  });
  fs.writeFileSync(
    fakeGenerator.commandPath,
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(fakeGenerator.logPath)}, args.join(" ") + "\\n");
if (args[0] === "run" && args[1] === "src/cmd/mbt2ts") {
  const outIndex = args.indexOf("--out");
  const outDir = outIndex >= 0 ? args[outIndex + 1] : null;
  if (!outDir) process.exit(2);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "index.js"), ${JSON.stringify(runtimeSource)});
  writeFileSync(path.join(outDir, "index.d.ts"), ${JSON.stringify(declarationSource)});
  writeFileSync(path.join(outDir, "package.json"), ${JSON.stringify(packageSource)});
}
`,
    { mode: 0o755 },
  );
}

test("ts bridge example keeps bridge bindings tree-shake friendly", () => {
  ensureExampleNodeModules();
  fs.rmSync(exampleDistDir, { recursive: true, force: true });
  const fakeGenerator = createFakeTsBridgeGenerator("", true);
  try {
    run("pnpm", ["build"], repoRoot);
    run("moon", ["build", "--release"], exampleDir);
    runWithEnv(
      "pnpm",
      ["exec", "vite", "build", "--config", "examples/ts_bridge_project/vite.config.ts"],
      repoRoot,
      {
        ...process.env,
        TS_MBT_GENERATOR_ROOT: fakeGenerator.root,
        TS_MBT_GENERATOR_COMMAND: fakeGenerator.commandPath,
      },
    );

    assert.ok(
      fs.existsSync(path.join(generatedBridgeDir, "bridge.mbt")),
      "checked-in bridge package should remain available",
    );
    const loggedCalls = fs
      .readFileSync(fakeGenerator.logPath, "utf-8")
      .trim()
      .split("\n");
    assert.deepEqual(loggedCalls.slice(0, 2), [
      "build --target js --release src/mtsc",
      `checkGraph:${path.join(exampleDir, "src", "api", "math.ts")}?false|`,
    ]);
    assert.equal(
      loggedCalls[2],
      [
        "run",
        "src/cmd/ts2mbt",
        "--",
        "package",
        path.join(exampleDir, "src", "api", "math.ts"),
        "/src/api/math.ts",
        path.join(exampleDir, "src", "gen", "math_bridge"),
      ].join(" "),
    );

    const bundle = readExampleBundle();
    assert.ok(
      !bundle.includes("TS_BRIDGE_UNUSED_SENTINEL"),
      "unused TS bridge exports should be tree-shaken from the final bundle",
    );
    assert.ok(
      !bundle.includes("globalThis.__ts_mbt_"),
      "final bundle should not rely on globalThis bridge bindings",
    );
  } finally {
    fs.rmSync(fakeGenerator.root, { recursive: true, force: true });
  }
});

test("ts bridge type errors stop generation before MoonBit build", () => {
  ensureExampleNodeModules();
  const fakeGenerator = createFakeTsBridgeGenerator("TYPE_ERROR: invalid bridge input");
  try {
    run("pnpm", ["build"], repoRoot);
    const result = spawnSync(
      "pnpm",
      ["exec", "vite", "build", "--config", "examples/ts_bridge_project/vite.config.ts"],
      {
        cwd: repoRoot,
        encoding: "utf-8",
        env: {
          ...process.env,
          TS_MBT_GENERATOR_ROOT: fakeGenerator.root,
          TS_MBT_GENERATOR_COMMAND: fakeGenerator.commandPath,
        },
      },
    );
    assert.notEqual(result.status, 0, "Vite must fail on mtsc diagnostics");
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /Type checking TS bridge entry failed/);
    assert.match(output, /TYPE_ERROR: invalid bridge input/);
    assert.deepEqual(
      fs.readFileSync(fakeGenerator.logPath, "utf-8").trim().split("\n"),
      [
        "build --target js --release src/mtsc",
        `checkGraph:${path.join(exampleDir, "src", "api", "math.ts")}?false|`,
      ],
      "bridge generation must not run after a type-check failure",
    );
  } finally {
    fs.rmSync(fakeGenerator.root, { recursive: true, force: true });
  }
});

test("ts bridge opts into generated runtime validators explicitly", () => {
  ensureExampleNodeModules();
  const fakeGenerator = createFakeTsBridgeGenerator();
  try {
    run("pnpm", ["build"], repoRoot);
    runWithEnv(
      "pnpm",
      ["exec", "vite", "build", "--config", "examples/ts_bridge_project/vite.config.ts"],
      repoRoot,
      {
        ...process.env,
        TS_MBT_GENERATOR_ROOT: fakeGenerator.root,
        TS_MBT_GENERATOR_COMMAND: fakeGenerator.commandPath,
        TS_MBT_RUNTIME_VALIDATION: "1",
      },
    );
    const loggedCalls = fs
      .readFileSync(fakeGenerator.logPath, "utf-8")
      .trim()
      .split("\n");
    assert.equal(
      loggedCalls.at(-1),
      [
        "run",
        "src/cmd/ts2mbt",
        "--",
        "package-validated",
        path.join(exampleDir, "src", "api", "math.ts"),
        "/src/api/math.ts",
        path.join(exampleDir, "src", "gen", "math_bridge"),
      ].join(" "),
    );
  } finally {
    fs.rmSync(fakeGenerator.root, { recursive: true, force: true });
  }
});

test("npm package option generates a publishable MoonBit facade through mbt2ts", () => {
  ensureExampleNodeModules();
  const generatedMbtiPath = path.join(
    exampleDir,
    "src",
    "pkg.generated.mbti",
  );
  const originalGeneratedMbti = fs.existsSync(generatedMbtiPath)
    ? fs.readFileSync(generatedMbtiPath, "utf-8")
    : null;
  const fakeGenerator = createFakeTsBridgeGenerator();
  try {
    fs.writeFileSync(
      generatedMbtiPath,
      'package "internal/app"\n\npub fn describe_scaled_point(Double, Double, Double) -> String\n',
    );
    run("pnpm", ["build"], repoRoot);
    runWithEnv(
      "pnpm",
      ["exec", "vite", "build", "--config", "examples/ts_bridge_project/vite.config.ts"],
      repoRoot,
      {
        ...process.env,
        TS_MBT_GENERATOR_ROOT: fakeGenerator.root,
        TS_MBT_GENERATOR_COMMAND: fakeGenerator.commandPath,
        TS_MBT_ENABLE_NPM_PACKAGE: "1",
        TS_MBT_NPM_BUNDLE: "0",
      },
    );
    const loggedCalls = fs
      .readFileSync(fakeGenerator.logPath, "utf-8")
      .trim()
      .split("\n");
    assert.ok(
      loggedCalls.includes("info"),
      "npm packaging refreshes pkg.generated.mbti before generation",
    );
    assert.ok(
      loggedCalls.includes(
        [
          "run",
          "src/cmd/mbt2ts",
          "--",
          "--input",
          generatedMbtiPath,
          "--out",
          path.join(exampleDir, "dist", "npm"),
        ].join(" "),
      ),
      "npm packaging delegates to the build-backed mbt2ts facade generator",
    );
  } finally {
    if (originalGeneratedMbti === null) {
      fs.rmSync(generatedMbtiPath, { force: true });
    } else {
      fs.writeFileSync(generatedMbtiPath, originalGeneratedMbti);
    }
    fs.rmSync(fakeGenerator.root, { recursive: true, force: true });
  }
});

test("npm package bundles local TypeScript bridge runtime for Node consumers", async () => {
  ensureExampleNodeModules();
  const generatedMbtiPath = path.join(exampleDir, "src", "pkg.generated.mbti");
  const npmOutDir = path.join(exampleDistDir, "npm");
  const originalGeneratedMbti = fs.existsSync(generatedMbtiPath)
    ? fs.readFileSync(generatedMbtiPath, "utf-8")
    : null;
  const fakeGenerator = createFakeTsBridgeGenerator();
  makeNpmEmittingFakeCommand(fakeGenerator);
  try {
    fs.writeFileSync(
      generatedMbtiPath,
      'package "internal/app"\n\npub fn scale_point(Double, Double, Double) -> Unit\n',
    );
    run("pnpm", ["build"], repoRoot);
    runWithEnv(
      "pnpm",
      ["exec", "vite", "build", "--config", "examples/ts_bridge_project/vite.config.ts"],
      repoRoot,
      {
        ...process.env,
        TS_MBT_GENERATOR_ROOT: fakeGenerator.root,
        TS_MBT_GENERATOR_COMMAND: fakeGenerator.commandPath,
        TS_MBT_ENABLE_NPM_PACKAGE: "1",
        TS_MBT_NPM_NAME: "@mizchi/ts-moonbit-example",
        TS_MBT_NPM_VERSION: "1.2.3",
      },
    );
    const publishedRuntime = fs.readFileSync(path.join(npmOutDir, "index.js"), "utf-8");
    assert.doesNotMatch(publishedRuntime, /@tsmbt-bridge|\/src\/api\/math\.ts/);
    const publishedPackage = JSON.parse(
      fs.readFileSync(path.join(npmOutDir, "package.json"), "utf-8"),
    );
    assert.equal(publishedPackage.name, "@mizchi/ts-moonbit-example");
    assert.equal(publishedPackage.version, "1.2.3");
    const published = await import(
      `${pathToFileURL(path.join(npmOutDir, "index.js")).href}?v=${Date.now()}`,
    );
    assert.deepEqual(published.scalePoint(1, 2, 3), { x: 3, y: 6 });
  } finally {
    fs.rmSync(npmOutDir, { recursive: true, force: true });
    if (originalGeneratedMbti === null) {
      fs.rmSync(generatedMbtiPath, { force: true });
    } else {
      fs.writeFileSync(generatedMbtiPath, originalGeneratedMbti);
    }
    fs.rmSync(fakeGenerator.root, { recursive: true, force: true });
  }
});

test("ts bridge checks local imported modules before generation", () => {
  ensureExampleNodeModules();
  const entryPath = path.join(exampleDir, "src", "api", "math.ts");
  const dependencyPath = path.join(
    exampleDir,
    "src",
    "api",
    "type-error-dependency.ts",
  );
  const originalEntry = fs.readFileSync(entryPath, "utf-8");
  const fakeGenerator = createFakeTsBridgeGenerator("TYPE_ERROR: dependency");
  try {
    fs.writeFileSync(
      dependencyPath,
      "export function brokenDependency(value: number): string { return value; }\n",
    );
    fs.writeFileSync(
      entryPath,
      `import { brokenDependency } from "./type-error-dependency";\n${originalEntry}\nexport const bridgeDependencyValue = brokenDependency(1);\n`,
    );
    run("pnpm", ["build"], repoRoot);
    const result = spawnSync(
      "pnpm",
      ["exec", "vite", "build", "--config", "examples/ts_bridge_project/vite.config.ts"],
      {
        cwd: repoRoot,
        encoding: "utf-8",
        env: {
          ...process.env,
          TS_MBT_GENERATOR_ROOT: fakeGenerator.root,
          TS_MBT_GENERATOR_COMMAND: fakeGenerator.commandPath,
        },
      },
    );
    assert.notEqual(result.status, 0, "Vite must fail on mtsc diagnostics");
    assert.match(`${result.stdout}\n${result.stderr}`, /TYPE_ERROR: dependency/);
    assert.deepEqual(
      fs.readFileSync(fakeGenerator.logPath, "utf-8").trim().split("\n"),
      [
        "build --target js --release src/mtsc",
        [
          `checkGraph:${entryPath}?false`,
          `${dependencyPath}?false|${entryPath}=>./type-error-dependency=>${dependencyPath}`,
        ].join(","),
      ],
      "all resolved local TS modules must be checked before generation",
    );
  } finally {
    fs.writeFileSync(entryPath, originalEntry);
    fs.rmSync(dependencyPath, { force: true });
    fs.rmSync(fakeGenerator.root, { recursive: true, force: true });
  }
});
