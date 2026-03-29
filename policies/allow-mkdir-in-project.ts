import { resolve } from "node:path";
import { allow, next, type Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const allowMkdirInProject: Policy = {
  name: "Allow mkdir in project",
  description: "Permits mkdir commands when all paths are within the project root",
  handler: async (call) => {
    const args = await safeBashCommand(call);
    if (!args || args[0] !== "mkdir") return next();
    if (!call.context.projectRoot) return next();

    const root = call.context.projectRoot;
    const paths = args.slice(1).filter((t) => !t.startsWith("-"));

    if (paths.length === 0) return next();

    const allInProject = paths.every((p) => {
      const resolved = resolve(call.context.cwd, p);
      return resolved === root || resolved.startsWith(root + "/");
    });

    return allInProject ? allow() : next();
  },
};
export default allowMkdirInProject;
