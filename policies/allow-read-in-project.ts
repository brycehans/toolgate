import { realpathSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { allow, next, isWithinProject, type Policy } from "../src";

function resolvePath(p: string, projectRoot: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (!p.startsWith("/")) return resolve(projectRoot, p);
  return p;
}

function tryRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Allow file reads (Read tool) when the target is within the project directory
 * or any additional directory. Resolves symlinks to prevent escaping via symlinked paths.
 */
const allowReadInProject: Policy = {
  name: "Allow read in project",
  description: "Permits Read tool calls targeting files within the project root or additional directories",
  handler: async (call) => {
    if (call.tool !== "Read") {
      return next();
    }

    if (!call.context.projectRoot) {
      return next();
    }

    const filePath = call.args.file_path;
    if (typeof filePath !== "string") return next();

    const resolved = resolvePath(filePath, call.context.projectRoot);

    // If the file exists, resolve symlinks and check the real path
    const realTarget = tryRealpath(resolved);
    if (realTarget) {
      // Build a context with realpath-resolved dirs for accurate matching
      const realContext = { ...call.context };
      const realRoot = tryRealpath(call.context.projectRoot);
      if (realRoot) {
        realContext.projectRoot = realRoot;
        realContext.additionalDirs = (call.context.additionalDirs ?? [])
          .map((d) => tryRealpath(d) ?? d);
      }
      return isWithinProject(realTarget, realContext) ? allow() : next();
    }

    // File doesn't exist yet — fall back to string prefix check
    return isWithinProject(resolved, call.context) ? allow() : next();
  },
};
export default allowReadInProject;
