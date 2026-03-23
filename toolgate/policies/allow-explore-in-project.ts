import { allow, next, type Policy } from "../../src";

/**
 * Allow the Explore agent, but only when invoked within the project directory.
 */
const allowExploreInProject: Policy = {
  name: "Allow explore in project",
  description: "Permits the Explore agent when cwd is within the project root",
  handler: async (call) => {
    if (call.tool !== "Agent") {
      return next();
    }

    if (call.args.subagent_type !== "Explore") {
      return next();
    }

    if (!call.context.projectRoot || !call.context.cwd.startsWith(call.context.projectRoot)) {
      return next();
    }

    return allow();
  },
};
export default allowExploreInProject;
