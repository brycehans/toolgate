import type { Policy } from "../src";

const CRON_TOOLS = new Set(["CronCreate", "CronDelete", "CronList"]);

/**
 * Allow all Cron CRUD tool calls unconditionally.
 */
const allowCronCrud: Policy = {
  name: "Allow Cron CRUD",
  description: "Permits CronCreate, CronDelete, and CronList tool calls",
  action: "allow",
  handler: async (call) => {
    if (!CRON_TOOLS.has(call.tool)) {
      return;
    }

    return true;
  },
};
export default allowCronCrud;
