import { resolve } from "node:path";
import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

/**
 * Allow rmdir for the project's tmp/ directory and empty subdirectories within it.
 * rmdir refuses to remove non-empty directories regardless of flags, so this
 * cannot delete data — only clean up empty scaffolding.
 */
const allowRmdirProjectTmp: Policy = {
  name: "Allow rmdir in project tmp/",
  description:
    "Permits rmdir for the project's tmp/ directory or empty subdirectories within it",
  action: "allow",
  handler: async (call) => {
    const args = await safeBashCommand(call);
    if (!args || args[0] !== "rmdir") return;
    if (!call.context.projectRoot) return;

    const tmpDirs = [call.context.projectRoot, ...(call.context.additionalDirs ?? [])]
      .map((d) => resolve(d, "tmp"));
    const paths = args.slice(1).filter((t) => !t.startsWith("-"));

    if (paths.length === 0) return;

    const allInTmp = paths.every((p) => {
      const resolved = resolve(call.context.cwd, p);
      return tmpDirs.some((tmp) => resolved === tmp || resolved.startsWith(tmp + "/"));
    });

    return allInTmp ? true : undefined;
  },
};
export default allowRmdirProjectTmp;
