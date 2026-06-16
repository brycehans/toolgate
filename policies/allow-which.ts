import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowWhich: Policy = {
  name: "Allow which",
  description: "Permits which for resolving command paths from $PATH; optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] !== "which") return;
    return true;
  },
};
export default allowWhich;
