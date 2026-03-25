import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowGitDiff: Policy = {
  name: "Allow git diff",
  description: "Permits git diff commands, optionally piped through safe filters",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] === "git" && tokens[1] === "diff") return allow();
    return next();
  },
};
export default allowGitDiff;
