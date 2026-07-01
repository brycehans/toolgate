import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowGitAdd: Policy = {
  name: "Allow git add",
  description: "Permits git add commands, optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] === "git" && tokens[1] === "add") return true;
    return;
  },
};
export default allowGitAdd;
