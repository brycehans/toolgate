import { isWithinProject, type Policy } from "../src";

/**
 * Allow Plan tool calls when the path is within the project root.
 * Also allows when no path is specified (defaults to cwd, which is in-project).
 */
const allowPlanInProject: Policy = {
  name: "Allow plan in project",
  description: "Permits Plan tool calls targeting paths within the project root",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Plan") {
      return;
    }

    if (!call.context.projectRoot) {
      return;
    }

    const searchPath = call.args.path;

    // No path specified — Plan defaults to cwd
    if (searchPath === undefined) {
      return isWithinProject(call.context.cwd, call.context) ? true : undefined;
    }

    if (typeof searchPath !== "string") {
      return;
    }

    return isWithinProject(searchPath, call.context) ? true : undefined;
  },
};
export default allowPlanInProject;
