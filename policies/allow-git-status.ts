import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowGitStatus: Policy = {
  name: "Allow git status",
  description: "Permits git status commands, optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] === "git" && tokens[1] === "status") return true;
    return;
  },
};
export default allowGitStatus;
