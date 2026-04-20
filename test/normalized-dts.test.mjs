import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const exampleDir = path.join(repoRoot, "examples", "ts_bridge_project");
const exampleNodeModulesDir = path.join(exampleDir, "node_modules");
const normalizedDtsPath = path.join(
  exampleDir,
  "_build",
  "js",
  "release",
  "build",
  "app.d.ts",
);

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

function createFakeNormalizedDtsGenerator() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "vite-plugin-moonbit-normalized-dts-"),
  );
  const logPath = path.join(root, "args.log");
  const commandPath = path.join(root, "fake-moon");
  fs.writeFileSync(path.join(root, "moon.mod.json"), "{}\n");
  fs.writeFileSync(
    commandPath,
    `#!/bin/sh
printf '%s\n' "$@" > "${logPath}"
cat <<'EOF' > "$6"
export type __NormalizedDtsSentinel = "NORMALIZED_DTS_SENTINEL";
EOF
exit 0
`,
    { mode: 0o755 },
  );
  return { root, logPath, commandPath };
}

test("normalizedDts rewrites generated declaration files in place", () => {
  ensureExampleNodeModules();
  const fakeGenerator = createFakeNormalizedDtsGenerator();
  try {
    fs.rmSync(path.join(exampleDir, "_build"), { recursive: true, force: true });
    run("pnpm", ["build"], repoRoot);
    run("moon", ["build", "--release"], exampleDir);
    const original = fs.readFileSync(normalizedDtsPath, "utf-8");
    assert.ok(
      original.includes("MoonBit."),
      "expected the raw MoonBit-generated declaration before normalization",
    );

    const viteBuild = runWithEnv(
      "pnpm",
      ["exec", "vite", "build", "--config", "examples/ts_bridge_project/vite.config.ts"],
      repoRoot,
      {
        ...process.env,
        TS_MBT_GENERATOR_ROOT: fakeGenerator.root,
        TS_MBT_GENERATOR_COMMAND: fakeGenerator.commandPath,
        TS_MBT_ENABLE_NORMALIZED_DTS: "1",
      },
    );

    assert.match(
      viteBuild.stdout,
      new RegExp(
        `normalizedDts will use generatorRoot ${fakeGenerator.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );

    const loggedArgs = fs.readFileSync(fakeGenerator.logPath, "utf-8").trim().split("\n");
    assert.deepEqual(loggedArgs, [
      "run",
      "src",
      "--",
      "normalize-moonbit-dts",
      normalizedDtsPath,
      normalizedDtsPath,
    ]);

    const rewritten = fs.readFileSync(normalizedDtsPath, "utf-8");
    assert.ok(
      rewritten.includes("NORMALIZED_DTS_SENTINEL"),
      "normalized d.ts should be rewritten in place",
    );
    assert.ok(
      !rewritten.includes("MoonBit."),
      "normalized d.ts should no longer keep raw MoonBit namespace aliases",
    );
  } finally {
    fs.rmSync(fakeGenerator.root, { recursive: true, force: true });
  }
});
