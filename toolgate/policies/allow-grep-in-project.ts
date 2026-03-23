import { resolve } from "node:path";
import { allow, next, type Policy } from "../../src";

/**
 * Allow Grep tool calls when the search path is within the project root.
 * Also allows when no path is specified (defaults to cwd, which is in-project).
 */
const allowGrepInProject: Policy = {
  name: "Allow grep in project",
  description: "Permits Grep tool calls targeting paths within the project root",
  handler: async (call) => {
    if (call.tool !== "Grep") {
      return next();
    }

    if (!call.context.projectRoot) {
      return next();
    }

    const searchPath = call.args.path;

    // No path specified — Grep defaults to cwd
    if (searchPath === undefined) {
      if (call.context.cwd.startsWith(call.context.projectRoot)) {
        return allow();
      }
      return next();
    }

    if (typeof searchPath !== "string") {
      return next();
    }

    // Resolve relative paths against cwd
    const resolved = resolve(call.context.cwd, searchPath);

    if (resolved.startsWith(call.context.projectRoot + "/") || resolved === call.context.projectRoot) {
      return allow();
    }

    return next();
  },
};
export default allowGrepInProject;
