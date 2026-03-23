import { allow, next, type Policy } from "../../src";

/**
 * Allow TaskCreate tool calls unconditionally.
 */
const allowTaskCreate: Policy = {
  name: "Allow TaskCreate",
  description: "Permits TaskCreate tool calls for task tracking",
  handler: async (call) => {
    if (call.tool !== "TaskCreate") {
      return next();
    }

    return allow();
  },
};
export default allowTaskCreate;
