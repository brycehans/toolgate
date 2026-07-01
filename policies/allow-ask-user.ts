import type { Policy } from "../src";

/**
 * Allow all AskUserQuestion tool calls unconditionally.
 * This tool already requires user interaction to answer,
 * so auto-approving the prompt itself is safe.
 */
const allowAskUser: Policy = {
  name: "Allow AskUserQuestion",
  description: "Permits all AskUserQuestion tool calls",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "AskUserQuestion") return;
    return true;
  },
};
export default allowAskUser;
