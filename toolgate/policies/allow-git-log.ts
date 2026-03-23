import { allow, next, type Policy } from "../../src";
import { safeBashTokens } from "./parse-bash";

/**
 * Allow simple `git log` commands. Rejects compound commands,
 * shell substitutions, and multiline inputs.
 */
const allowGitLog: Policy = {
  name: "Allow git log",
  description: "Permits simple git log commands without chaining or substitution",
  handler: async (call) => {
    const tokens = safeBashTokens(call);
    if (!tokens) return next();

    if (tokens[0] === "git" && tokens[1] === "log") {
      return allow();
    }

    return next();
  },
};
export default allowGitLog;
