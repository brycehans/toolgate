import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

/**
 * Allow `toolgate test ...`. The `test` subcommand is a dry-run that parses
 * a tool call and reports which policy would fire — it never executes the
 * underlying tool, so any argument shape is safe.
 */
const allowToolgateTest: Policy = {
  name: "Allow toolgate test",
  description: "Permits toolgate test (dry-run policy check) with any arguments",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return;
    if (tokens[0] !== "toolgate" || tokens[1] !== "test") return;
    return true;
  },
};
export default allowToolgateTest;
