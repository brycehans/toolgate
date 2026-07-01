import type { Policy } from "../src";

/**
 * Allow all ToolSearch tool calls unconditionally.
 * ToolSearch only fetches tool schemas — it has no side effects.
 */
const allowToolSearch: Policy = {
  name: "Allow ToolSearch",
  description: "Permits all ToolSearch tool calls",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "ToolSearch") return;
    return true;
  },
};
export default allowToolSearch;
