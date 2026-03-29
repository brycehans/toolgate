import { allow, next, type Policy } from "../src";

const PLAN_MODE_TOOLS = new Set(["EnterPlanMode", "ExitPlanMode"]);

/**
 * Allow EnterPlanMode and ExitPlanMode tool calls unconditionally.
 * These are workflow tools with no file system side effects.
 */
const allowPlanMode: Policy = {
  name: "Allow Plan Mode",
  description: "Permits EnterPlanMode and ExitPlanMode tool calls",
  handler: async (call) => {
    if (!PLAN_MODE_TOOLS.has(call.tool)) {
      return next();
    }

    return allow();
  },
};
export default allowPlanMode;
