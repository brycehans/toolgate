import { allow, next, type Policy } from "../../src";
import { safeBashTokens } from "./parse-bash";

/**
 * Allow simple `git diff` commands. Rejects compound commands,
 * shell substitutions, and multiline inputs.
 */
const allowGitDiff: Policy = {
  name: "Allow git diff",
  description: "Permits simple git diff commands without chaining or substitution",
  handler: async (call) => {
    const tokens = safeBashTokens(call);
    if (!tokens) return next();

    if (tokens[0] === "git" && tokens[1] === "diff") {
      return allow();
    }

    return next();
  },
};
export default allowGitDiff;
