import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";
import { isGitOutputFlag } from "./deny-git-output-flag";

const allowGitLog: Policy = {
  name: "Allow git log/show",
  description:
    "Permits git log and git show commands, optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens.slice(2).some(isGitOutputFlag)) return;
    if (tokens[0] === "git" && (tokens[1] === "log" || tokens[1] === "show"))
      return true;
    return;
  },
};
export default allowGitLog;
