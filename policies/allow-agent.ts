import { allow, next, type Policy } from "../src";

/**
 * Allow all Agent (subagent) tool calls unconditionally.
 */
const allowAgent: Policy = {
  name: "Allow agent",
  description: "Permits all Agent subagent invocations",
  handler: async (call) => {
    if (call.tool !== "Agent") {
      return next();
    }

    return allow();
  },
};
export default allowAgent;
