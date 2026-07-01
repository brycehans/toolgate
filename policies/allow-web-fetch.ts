import type { Policy } from "../src";

/**
 * Allow all WebFetch tool calls unconditionally.
 * WebFetch is read-only HTTP fetching and safe to auto-approve.
 */
const allowWebFetch: Policy = {
  name: "Allow WebFetch",
  description: "Permits all WebFetch tool calls",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "WebFetch") return;
    return true;
  },
};
export default allowWebFetch;
