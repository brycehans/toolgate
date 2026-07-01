import type { Policy } from "../src";
import {
  parseShell,
  getAllLeafCommands,
  getArgs,
  isPureCommand,
} from "./parse-bash-ast";

const denyMixedPureChains: Policy = {
  name: "Deny mixed pure chains",
  description:
    "Blocks compound commands mixing pure (sleep, echo) and non-pure commands, forcing separate steps",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    const command = call.args?.command;
    if (typeof command !== "string") return;

    const ast = await parseShell(command);
    if (!ast) return;

    const leaves = getAllLeafCommands(ast);
    if (!leaves || leaves.length < 2) return;

    let hasPure = false;
    let hasNonPure = false;

    for (const leaf of leaves) {
      const args = getArgs(leaf);
      if (args && isPureCommand(args)) {
        hasPure = true;
      } else {
        hasNonPure = true;
      }
      if (hasPure && hasNonPure) {
        return "Split pure commands (sleep, echo, etc.) from other commands so each can be evaluated independently";
      }
    }
  },
};
export default denyMixedPureChains;
