import { allow, next, type Policy } from "../../src";

/**
 * Allow file reads (Read tool) when the target is within the project directory.
 */
const allowReadInProject: Policy = {
  name: "Allow read in project",
  description: "Permits Read tool calls targeting files within the project root",
  handler: async (call) => {
    if (call.tool !== "Read") {
      return next();
    }

    if (!call.context.projectRoot) {
      return next();
    }

    const filePath = call.args.file_path;
    if (typeof filePath !== "string" || !filePath.startsWith(call.context.projectRoot)) {
      return next();
    }

    return allow();
  },
};
export default allowReadInProject;
