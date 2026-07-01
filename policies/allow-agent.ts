import type { Policy } from "../src";

/**
 * Allow all Agent (subagent) tool calls unconditionally.
 */
const allowAgent: Policy = {
  name: "Allow agent",
  description: "Permits all Agent subagent invocations",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Agent") {
      return;
    }

    return true;
  },
};
export default allowAgent;
