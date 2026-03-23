import { allow, next, type Policy } from "../../src";
import { safeBashTokens } from "./parse-bash";

/**
 * Allow simple `ls` commands when all path arguments are within the project root.
 * Also allows bare `ls` (no path args) when cwd is within the project.
 */
const allowLsInProject: Policy = {
  name: "Allow ls in project",
  description: "Permits ls commands when all paths are within the project root",
  handler: async (call) => {
    const tokens = safeBashTokens(call);
    if (!tokens) return next();

    if (tokens[0] !== "ls") return next();
    if (!call.context.projectRoot) return next();

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
