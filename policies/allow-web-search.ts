import { allow, next, type Policy } from "../src";

/**
 * Allow all WebSearch tool calls unconditionally.
 * WebSearch is read-only and safe to auto-approve.
 */
const allowWebSearch: Policy = {
  name: "Allow WebSearch",
  description: "Permits all WebSearch tool calls",
  handler: async (call) => {
    if (call.tool !== "WebSearch") return next();
    return allow();
  },
};
export default allowWebSearch;
