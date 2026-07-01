import { isWithinProject, type Policy } from "../src";

/**
 * Allow the Explore agent, but only when invoked within the project directory.
 */
const allowExploreInProject: Policy = {
  name: "Allow explore in project",
  description: "Permits the Explore agent when cwd is within the project root",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Agent") {
      return;
    }

    if (call.args.subagent_type !== "Explore") {
      return;
    }

    if (!call.context.projectRoot || !isWithinProject(call.context.cwd, call.context)) {
      return;
    }

    return true;
  },
};
export default allowExploreInProject;
