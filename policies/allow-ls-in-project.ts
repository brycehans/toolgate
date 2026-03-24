import { allow, next, type Policy } from "../src";
import { safeBashPipeline, isSafeFilter } from "./parse-bash";

/**
 * Allow simple `ls` commands when all path arguments are within the project root.
 * Also allows bare `ls` (no path args) when cwd is within the project.
 * Supports piping to safe filter commands (grep, head, tail, etc.)
 */
const allowLsInProject: Policy = {
  name: "Allow ls in project",
  description: "Permits ls commands when all paths are within the project root",
  handler: async (call) => {
    const pipeline = safeBashPipeline(call);
    if (!pipeline) return next();

    const tokens = pipeline[0];
    if (tokens[0] !== "ls") return next();
    if (!call.context.projectRoot) return next();

    // All pipe segments after the first must be safe filters
    for (let i = 1; i < pipeline.length; i++) {
      if (!isSafeFilter(pipeline[i])) return next();
    }

    const root = call.context.projectRoot;
    const args = tokens.slice(1);
    const paths = args.filter((t) => !t.startsWith("-"));

    // Bare `ls` or `ls -flags` with no paths — check cwd
    if (paths.length === 0) {
      if (call.context.cwd.startsWith(root + "/") || call.context.cwd === root) {
        return allow();
      }
      return next();
    }

    // All paths must be within project root
    const allInProject = paths.every(
      (p) => p.startsWith(root + "/") || p === root || p.startsWith("./") || p === "." || !p.startsWith("/"),
    );

    if (allInProject) {
      return allow();
    }

    return next();
  },
};
export default allowLsInProject;
