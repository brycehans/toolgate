import { allow, next, type Policy } from "../../src";
import { safeBashTokens } from "./parse-bash";

/**
 * Allow simple `git status` commands. Rejects compound commands,
 * shell substitutions, and multiline inputs.
 */
const allowGitStatus: Policy = {
  name: "Allow git status",
  description: "Permits simple git status commands without chaining or substitution",
  handler: async (call) => {
    const tokens = safeBashTokens(call);
    if (!tokens) return next();

    if (tokens[0] === "git" && tokens[1] === "status") {
      return allow();
    }

    return next();
  },
};
export default allowGitStatus;
