import type { Policy } from "../src";

const TASK_TOOLS = new Set([
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskOutput",
]);

/**
 * Allow all Task CRUD tool calls unconditionally.
 */
const allowTaskCrud: Policy = {
  name: "Allow Task CRUD",
  description:
    "Permits TaskCreate, TaskUpdate, TaskGet, TaskList, TaskOutput, and TaskStop tool calls",
  action: "allow",
  handler: async (call) => {
    if (!TASK_TOOLS.has(call.tool)) {
      return;
    }

    return true;
  },
};
export default allowTaskCrud;
