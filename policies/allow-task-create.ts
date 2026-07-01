import type { Policy } from "../src";

/**
 * Allow TaskCreate tool calls unconditionally.
 */
const allowTaskCreate: Policy = {
  name: "Allow TaskCreate",
  description: "Permits TaskCreate tool calls for task tracking",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "TaskCreate") {
      return;
    }

    return true;
  },
};
export default allowTaskCreate;
