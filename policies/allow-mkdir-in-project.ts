import { resolve } from "node:path";
import { isWithinProject, type Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const allowMkdirInProject: Policy = {
  name: "Allow mkdir in project",
  description: "Permits mkdir commands when all paths are within the project root",
  action: "allow",
  handler: async (call) => {
    const args = await safeBashCommand(call);
    if (!args || args[0] !== "mkdir") return;
    if (!call.context.projectRoot) return;

    const root = call.context.projectRoot;
    const paths = args.slice(1).filter((t) => !t.startsWith("-"));

    if (paths.length === 0) return;

    const allInProject = paths.every((p) => {
      const resolved = resolve(call.context.cwd, p);
      return isWithinProject(resolved, call.context);
    });

    return allInProject ? true : undefined;
  },
};
export default allowMkdirInProject;
