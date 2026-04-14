import { deny, next, type Policy } from "../src";
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
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    const command = call.args?.command;
    if (typeof command !== "string") return next();

    const ast = await parseShell(command);
    if (!ast) return next();

    const leaves = getAllLeafCommands(ast);
    if (!leaves || leaves.length < 2) return next();

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
        return deny(
          "Split pure commands (sleep, echo, etc.) from other commands so each can be evaluated independently",
        );
      }
    }

    return next();
  },
};
export default denyMixedPureChains;
