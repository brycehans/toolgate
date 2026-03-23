import { allow, next, type Policy } from "../../src";
import { safeBashTokens } from "./parse-bash";

/**
 * Allow simple `bun test` commands. Rejects compound commands,
 * shell substitutions, and multiline inputs.
 */
const allowBunTest: Policy = {
  name: "Allow bun test",
  description: "Permits simple bun test commands without chaining or substitution",
  handler: async (call) => {
    const tokens = safeBashTokens(call);
    if (!tokens) return next();

    if (tokens[0] === "bun" && tokens[1] === "test") {
      return allow();
    }

    return next();
  },
};
export default allowBunTest;
