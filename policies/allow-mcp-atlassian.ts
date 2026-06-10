import { allow, deny, next, type Policy } from "../src";

/**
 * Allow all mcp__atlassian__* tool calls except delete operations.
 */
const allowMcpAtlassian: Policy = {
  name: "Allow MCP Atlassian",
  description:
    "Permits all Atlassian MCP tool calls except deleting Confluence pages",
  handler: async (call) => {
    if (!call.tool.startsWith("mcp__atlassian__")) return next();
    if (call.tool.includes("delete")) return deny("Atlassian delete operations require manual approval");
    return allow();
  },
};
export default allowMcpAtlassian;
