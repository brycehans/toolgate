import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowGitLog: Policy = {
  name: "Allow git log/show",
  description:
    "Permits git log and git show commands, optionally piped through safe filters",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] === "git" && (tokens[1] === "log" || tokens[1] === "show"))
      return allow();
    return next();
  },
};
export default allowGitLog;
