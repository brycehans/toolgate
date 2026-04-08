import { allow, next, isWithinProject, type Policy } from "../src";

/**
 * Allow Plan tool calls when the path is within the project root.
 * Also allows when no path is specified (defaults to cwd, which is in-project).
 */
const allowPlanInProject: Policy = {
  name: "Allow plan in project",
  description: "Permits Plan tool calls targeting paths within the project root",
  handler: async (call) => {
    if (call.tool !== "Plan") {
      return next();
    }

    if (!call.context.projectRoot) {
      return next();
    }

    const searchPath = call.args.path;

    // No path specified — Plan defaults to cwd
    if (searchPath === undefined) {
      return isWithinProject(call.context.cwd, call.context) ? allow() : next();
    }

    if (typeof searchPath !== "string") {
      return next();
    }

    return isWithinProject(searchPath, call.context) ? allow() : next();
  },
};
export default allowPlanInProject;
