import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

/**
 * Allow `toolgate logs`. The `logs` subcommand only prints the paths of
 * Claude Code's log files — it takes no arguments and writes nothing, so
 * any argument shape is safe.
 */
const allowToolgateLogs: Policy = {
  name: "Allow toolgate logs",
  description: "Permits toolgate logs (print log file locations)",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return;
    if (tokens[0] !== "toolgate" || tokens[1] !== "logs") return;
    return true;
  },
};
export default allowToolgateLogs;
