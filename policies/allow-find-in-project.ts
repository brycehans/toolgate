import { resolve } from "node:path";
import { allow, next, isWithinProject, type Policy } from "../src";

/**
 * Allow Find tool calls when the search path is within the project root.
 * Also allows when no path is specified (defaults to cwd, which is in-project).
 */
const allowFindInProject: Policy = {
  name: "Allow find in project",
  description: "Permits Find tool calls targeting paths within the project root",
  handler: async (call) => {
    if (call.tool !== "Find") {
      return next();
    }

    if (!call.context.projectRoot) {
      return next();
    }

    const searchPath = call.args.path;

    // No path specified — Find defaults to cwd
    if (searchPath === undefined) {
      return isWithinProject(call.context.cwd, call.context) ? allow() : next();
    }

    if (typeof searchPath !== "string") {
      return next();
    }

    // Resolve relative paths against cwd
    const resolved = resolve(call.context.cwd, searchPath);
    return isWithinProject(resolved, call.context) ? allow() : next();
  },
};
export default allowFindInProject;
