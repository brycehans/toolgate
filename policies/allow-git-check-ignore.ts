import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowGitCheckIgnore: Policy = {
  name: "Allow git check-ignore",
  description: "Permits git check-ignore commands, optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] === "git" && tokens[1] === "check-ignore") return true;
    return;
  },
};
export default allowGitCheckIgnore;
