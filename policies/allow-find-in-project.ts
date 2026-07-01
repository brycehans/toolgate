import { resolve } from "node:path";
import { isWithinProject, type Policy } from "../src";

/**
 * Allow Find tool calls when the search path is within the project root.
 * Also allows when no path is specified (defaults to cwd, which is in-project).
 */
const allowFindInProject: Policy = {
  name: "Allow find in project",
  description: "Permits Find tool calls targeting paths within the project root",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Find") {
      return;
    }

    if (!call.context.projectRoot) {
      return;
    }

    const searchPath = call.args.path;

    // No path specified — Find defaults to cwd
    if (searchPath === undefined) {
      return isWithinProject(call.context.cwd, call.context) ? true : undefined;
    }

    if (typeof searchPath !== "string") {
      return;
    }

    // Resolve relative paths against cwd
    const resolved = resolve(call.context.cwd, searchPath);
    return isWithinProject(resolved, call.context) ? true : undefined;
  },
};
export default allowFindInProject;
