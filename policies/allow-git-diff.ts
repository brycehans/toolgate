import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowGitDiff: Policy = {
  name: "Allow git diff",
  description: "Permits git diff commands, optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] === "git" && tokens[1] === "diff") return true;
    return;
  },
};
export default allowGitDiff;
