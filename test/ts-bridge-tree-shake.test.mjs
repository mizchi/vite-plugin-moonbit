import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const exampleDir = path.join(repoRoot, "examples", "ts_bridge_project");
const exampleNodeModulesDir = path.join(exampleDir, "node_modules");
const exampleDistDir = path.join(exampleDir, "dist");

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf-8",
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

test("ts bridge example keeps bridge bindings tree-shake friendly", () => {
  ensureExampleNodeModules();
  fs.rmSync(exampleDistDir, { recursive: true, force: true });

  run("pnpm", ["build"], repoRoot);
  run("moon", ["build", "--target", "js", "--release"], exampleDir);
  run(
    "pnpm",
    ["exec", "vite", "build", "--config", "examples/ts_bridge_project/vite.config.ts"],
    repoRoot,
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
});
