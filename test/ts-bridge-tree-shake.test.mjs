import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function createFakeTsBridgeGenerator() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "vite-plugin-moonbit-ts-bridge-"),
  );
  const logPath = path.join(root, "args.log");
  const commandPath = path.join(root, "fake-moon");
  fs.writeFileSync(path.join(root, "moon.mod.json"), "{}\n");
  fs.writeFileSync(
    commandPath,
    `#!/bin/sh
printf '%s\n' "$@" > "${logPath}"
exit 0
`,
    { mode: 0o755 },
  );
  return { root, logPath, commandPath };
}

test("ts bridge example keeps bridge bindings tree-shake friendly", () => {
  ensureExampleNodeModules();
  fs.rmSync(exampleDistDir, { recursive: true, force: true });
  const fakeGenerator = createFakeTsBridgeGenerator();
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
    const loggedArgs = fs
      .readFileSync(fakeGenerator.logPath, "utf-8")
      .trim()
      .split("\n");
    assert.deepEqual(loggedArgs, [
      "run",
      "src",
      "--",
      "emit-moonbit-bridge-package",
      path.join(exampleDir, "src", "api", "math.ts"),
      "/src/api/math.ts",
      path.join(exampleDir, "src", "gen", "math_bridge"),
    ]);

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
