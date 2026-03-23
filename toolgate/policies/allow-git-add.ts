import { allow, next, type Policy } from "../../src";
import { safeBashTokens } from "./parse-bash";

/**
 * Allow simple `git add` commands. Rejects compound commands,
 * shell substitutions, and multiline inputs.
 */
const allowGitAdd: Policy = {
  name: "Allow git add",
  description: "Permits simple git add commands without chaining or substitution",
  handler: async (call) => {
    const tokens = safeBashTokens(call);
    if (!tokens) return next();

    if (tokens[0] === "git" && tokens[1] === "add") {
      return allow();
    }

    return next();
  },
};
export default allowGitAdd;
