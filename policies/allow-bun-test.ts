import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowBunTest: Policy = {
  name: "Allow bun test",
  description: "Permits bun test commands, optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] === "bun" && tokens[1] === "test") return true;
    return;
  },
};
export default allowBunTest;
