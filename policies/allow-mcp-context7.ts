import type { Policy } from "../src";

/**
 * Allow all mcp__context7__* tool calls unconditionally.
 * These are read-only documentation lookups (resolve-library-id, query-docs).
 */
const allowMcpContext7: Policy = {
  name: "Allow MCP Context7",
  description: "Permits all Context7 documentation lookup tool calls",
  action: "allow",
  handler: async (call) => {
    if (!call.tool.startsWith("mcp__context7__")) return;
    return true;
  },
};
export default allowMcpContext7;
