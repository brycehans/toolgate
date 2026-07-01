import type { Policy } from "../src";

/**
 * Allow all mcp__ide__getDiagnostics tool calls unconditionally.
 * This is a read-only IDE diagnostics query and safe to auto-approve.
 */
const allowMcpIdeDiagnostics: Policy = {
  name: "Allow MCP IDE Diagnostics",
  description: "Permits all mcp__ide__getDiagnostics tool calls",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "mcp__ide__getDiagnostics") return;
    return true;
  },
};
export default allowMcpIdeDiagnostics;
