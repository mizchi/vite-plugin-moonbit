import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  readMemberInfo,
  readProjectInfo,
  readPkgManifest,
} from "../src/manifest.ts";

const here = import.meta.dirname;
const examples = path.join(here, "..", "examples");
const fixtures = path.join(here, "fixtures");

test("readMemberInfo reads name/source from moon.mod.json", () => {
  const member = readMemberInfo(path.join(examples, "js_project"));
  assert.ok(member);
  assert.equal(member.name, "internal/app");
  assert.equal(member.source, "src");
});

test("readProjectInfo: single module via moon.mod.json", () => {
  const info = readProjectInfo(path.join(examples, "js_project"));
  assert.ok(info);
  assert.equal(info.isWorkspace, false);
  assert.deepEqual(
    info.members.map((m) => m.name),
    ["internal/app"]
  );
});

test("readProjectInfo: workspace via moon.work DSL", () => {
  const info = readProjectInfo(path.join(examples, "monorepo_project"));
  assert.ok(info);
  assert.equal(info.isWorkspace, true);
  assert.deepEqual(info.members.map((m) => m.name).sort(), [
    "internal/app",
    "internal/shared",
  ]);
});

test("readMemberInfo reads moon.mod (DSL, no JSON)", () => {
  const member = readMemberInfo(path.join(fixtures, "dsl_module"));
  assert.ok(member);
  assert.equal(member.name, "example/dsl_app");
  assert.equal(member.source, "src");
});

test("readMemberInfo prefers moon.mod (DSL) over moon.mod.json", () => {
  // Mirrors moon's preferred_manifest_in_dir: the new DSL format wins.
  const member = readMemberInfo(path.join(fixtures, "dsl_both"));
  assert.ok(member);
  assert.equal(member.name, "example/from_dsl");
});

test("readProjectInfo: single module via moon.mod (DSL)", () => {
  const info = readProjectInfo(path.join(fixtures, "dsl_module"));
  assert.ok(info);
  assert.equal(info.isWorkspace, false);
  assert.deepEqual(
    info.members.map((m) => m.name),
    ["example/dsl_app"]
  );
});

test("readPkgManifest prefers moon.pkg (DSL) over moon.pkg.json", () => {
  const pkg = readPkgManifest(path.join(fixtures, "pkg_both"));
  assert.ok(pkg);
  assert.equal(pkg["is-main"], true);
});
