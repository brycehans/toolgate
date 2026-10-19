import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

/**
 * Allow `toolgate list`. The `list` subcommand only prints the loaded
 * policies and their disabled state — it takes no arguments and writes
 * nothing, so any argument shape is safe.
 */
const allowToolgateList: Policy = {
  name: "Allow toolgate list",
  description: "Permits toolgate list (print loaded policies)",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return;
    if (tokens[0] !== "toolgate" || tokens[1] !== "list") return;
    return true;
  },
};
export default allowToolgateList;
