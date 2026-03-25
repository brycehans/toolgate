import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowBunTest: Policy = {
  name: "Allow bun test",
  description: "Permits bun test commands, optionally piped through safe filters",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] === "bun" && tokens[1] === "test") return allow();
    return next();
  },
};
export default allowBunTest;
