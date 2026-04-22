import type { Policy } from "../src";

/**
 * Deny `git -C <path>` commands. Claude should use the current working
 * directory instead of specifying paths with -C.
 */
const denyGitDashC: Policy = {
  name: "Deny git -C",
  description:
    "Rejects git commands using -C flag — use the current working directory instead",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    const cmd = call.args.command;
    if (typeof cmd !== "string") return;

    if (/\bgit\s+-C\b/.test(cmd)) {
      return "Do not use `git -C <path>`. Just run the git command normally — it will use the current working directory.";
    }
  },
};
export default denyGitDashC;
