import { allow, next, type Policy } from "../src";

/**
 * Allow all WebFetch tool calls unconditionally.
 * WebFetch is read-only HTTP fetching and safe to auto-approve.
 */
const allowWebFetch: Policy = {
  name: "Allow WebFetch",
  description: "Permits all WebFetch tool calls",
  handler: async (call) => {
    if (call.tool !== "WebFetch") return next();
    return allow();
  },
};
export default allowWebFetch;
