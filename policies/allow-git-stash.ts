import { allow, next, type Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

/**
 * Stash subcommands that destroy stash entries — these should still prompt.
 */
const DESTRUCTIVE = new Set(["drop", "clear"]);

const allowGitStash: Policy = {
  name: "Allow safe git stash",
  description:
    "Permits git stash commands except destructive ones (drop, clear)",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return next();
    if (tokens[0] !== "git" || tokens[1] !== "stash") return next();

    const sub = tokens[2];
    if (sub && DESTRUCTIVE.has(sub)) return next();

    return allow();
  },
};
export default allowGitStash;
