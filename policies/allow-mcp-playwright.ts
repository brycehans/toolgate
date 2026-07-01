import type { Policy } from "../src";

/**
 * Allow all mcp__playwright__* tool calls unconditionally.
 * These are local browser automation actions (navigate, click, snapshot, etc.).
 */
const allowMcpPlaywright: Policy = {
  name: "Allow MCP Playwright",
  description: "Permits all Playwright browser automation tool calls",
  action: "allow",
  handler: async (call) => {
    if (!call.tool.startsWith("mcp__playwright__")) return;
    return true;
  },
};
export default allowMcpPlaywright;
