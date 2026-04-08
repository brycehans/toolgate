import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import type { CallContext } from "./types";

interface SettingsJson {
  permissions?: {
    additionalDirectories?: string[];
  };
}

/**
 * Read `permissions.additionalDirectories` from Claude Code settings files
 * and return resolved, deduplicated absolute paths.
 */
export function loadAdditionalDirs(projectRoot: string): string[] {
  const settingsPaths = [
    join(projectRoot, ".claude", "settings.local.json"),
    join(projectRoot, ".claude", "settings.json"),
    join(homedir(), ".claude", "settings.local.json"),
    join(homedir(), ".claude", "settings.json"),
  ];

  const dirs = new Set<string>();

  for (const p of settingsPaths) {
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, "utf-8");
      const settings: SettingsJson = JSON.parse(content);
      const additional = settings.permissions?.additionalDirectories;
      if (!Array.isArray(additional)) continue;
      for (const dir of additional) {
        if (typeof dir !== "string") continue;
        const resolved = resolve(projectRoot, dir);
        dirs.add(resolved);
      }
    } catch {
      // skip unreadable/unparseable settings
    }
  }

  // Remove projectRoot itself if listed — it's already the primary root
  dirs.delete(projectRoot);

  return [...dirs];
}

/**
 * Check whether a resolved absolute path is within the project root
 * or any additional directory.
 */
export function isWithinProject(resolvedPath: string, context: Pick<CallContext, "projectRoot"> & Partial<Pick<CallContext, "additionalDirs">>): boolean {
  const dirs = [context.projectRoot, ...(context.additionalDirs ?? [])];
  return dirs.some(
    (dir) => resolvedPath === dir || resolvedPath.startsWith(dir + "/"),
  );
}
