import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseMoonPkgDsl } from "../tools/moon_pkg_parser/_build/js/release/build/moon_pkg_parser.js";

export interface Member {
  name: string;
  source: string;
  memberDir: string;
}

export interface ProjectInfo {
  workspaceRoot: string;
  members: Member[];
  isWorkspace: boolean;
}

// moon prefers the new DSL format over the legacy JSON when both exist; see
// moon's `preferred_manifest_in_dir` (crates/moonutil/src/common.rs). Mirror
// that order here so the plugin selects the same manifest moon itself uses.
export const MOON_WORK_FILES = ["moon.work", "moon.work.json"];
export const MOON_MOD_FILES = ["moon.mod", "moon.mod.json"];
export const MOON_PKG_FILES = ["moon.pkg", "moon.pkg.json"];

/** Nearest module manifest in `dir`, preferring the DSL form over JSON. */
export function moduleManifestAt(dir: string): string | null {
  for (const name of MOON_MOD_FILES) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function readMemberInfo(memberDir: string): Member | null {
  const manifestPath = moduleManifestAt(memberDir);
  if (!manifestPath) return null;
  const mod = readMoonManifest(manifestPath);
  if (!mod || typeof mod.name !== "string") return null;
  return {
    name: mod.name,
    source: typeof mod.source === "string" ? mod.source : "src",
    memberDir,
  };
}

/**
 * Parse a moon manifest file (moon.mod, moon.work, moon.pkg and their `.json`
 * variants). For `.json` variants, use JSON.parse; for the DSL variants, route
 * through the MoonBit-native parser (built from moonbitlang/parser#pkg_parser).
 */
export function readMoonManifest(
  manifestPath: string
): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    if (manifestPath.endsWith(".json")) return JSON.parse(content);
    const parsed = JSON.parse(parseMoonPkgDsl(content));
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const errs = (parsed as { error: string[] }).error.join("; ");
      console.warn(`[moonbit] parse error in ${manifestPath}: ${errs}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseWorkspaceManifest(
  manifestPath: string
): { members: string[] } | null {
  const parsed = readMoonManifest(manifestPath);
  if (!parsed) return null;
  const members = Array.isArray(parsed.members)
    ? (parsed.members.filter((m) => typeof m === "string") as string[])
    : [];
  return { members };
}

export function workspaceManifestAt(dir: string): string | null {
  for (const name of MOON_WORK_FILES) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function parseMembers(manifestPath: string): Member[] {
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
        `[moonbit] workspace member has no readable moon.mod / moon.mod.json: ${memberDir}`
      );
  }
  return members;
}

/**
 * Mirrors moon's own logic (`find_applicable_workspace_manifest_path`):
 * walk ancestors, prefer the nearest module manifest when it is not a member
 * of any ancestor workspace. A `moon.work` only wins if the nearest module
 * is listed in its `members` (or no module has been seen yet).
 */
export function readProjectInfo(root: string): ProjectInfo | null {
  let dir = path.resolve(root);
  let nearestModuleDir: string | null = null;

  while (true) {
    const workspaceManifest = workspaceManifestAt(dir);
    if (workspaceManifest) {
      const members = parseMembers(workspaceManifest);
      const workspaceRoot = path.dirname(workspaceManifest);
      const memberDirs = new Set(members.map((m) => path.resolve(m.memberDir)));
      if (nearestModuleDir === null || memberDirs.has(nearestModuleDir)) {
        return { workspaceRoot, members, isWorkspace: true };
      }
      // Nearest module is not a member of this workspace: skip and keep walking.
    } else if (nearestModuleDir === null && moduleManifestAt(dir) !== null) {
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

export function readPkgManifest(
  pkgDir: string
): Record<string, unknown> | null {
  for (const name of MOON_PKG_FILES) {
    const p = path.join(pkgDir, name);
    if (fs.existsSync(p)) {
      const parsed = readMoonManifest(p);
      if (parsed) return parsed;
    }
  }
  return null;
}
