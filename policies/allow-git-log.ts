import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowGitLog: Policy = {
  name: "Allow git log",
  description: "Permits git log commands, optionally piped through safe filters",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] === "git" && tokens[1] === "log") return allow();
    return next();
  },
};
export default allowGitLog;
