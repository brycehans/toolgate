import { resolve } from "node:path";
import { allow, next, type Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

/**
 * Allow rm commands when all targets are within the project's tmp/ directory.
 * This supports the workflow where deny-gh-heredoc instructs Claude to write
 * content to tmp/ files and clean up afterwards.
 */
const allowRmProjectTmp: Policy = {
  name: "Allow rm in project tmp/",
  description:
    "Permits rm commands when all targets are within the project's tmp/ directory",
  handler: async (call) => {
    const args = await safeBashCommand(call);
    if (!args || args[0] !== "rm") return next();
    if (!call.context.projectRoot) return next();

    const tmpDirs = [call.context.projectRoot, ...(call.context.additionalDirs ?? [])]
      .map((d) => resolve(d, "tmp"));
    const paths = args.slice(1).filter((t) => !t.startsWith("-"));

    if (paths.length === 0) return next();

    const allInTmp = paths.every((p) => {
      const resolved = resolve(call.context.cwd, p);
      return tmpDirs.some((tmp) => resolved.startsWith(tmp + "/"));
    });

    return allInTmp ? allow() : next();
  },
};
export default allowRmProjectTmp;
