import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const allowPlaywright: Policy = {
  name: "Allow Playwright",
  description: "Permits npx playwright commands and all Playwright MCP tools",
  action: "allow",
  handler: async (call) => {
    // Allow all Playwright MCP tools
    if (call.tool.startsWith("mcp__playwright__")) return true;

    // Allow npx playwright commands
    const tokens = await safeBashCommand(call);
    if (!tokens) return;
    if (tokens[0] === "npx" && tokens[1] === "playwright") return true;

    return;
  },
};
export default allowPlaywright;
