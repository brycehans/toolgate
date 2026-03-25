import { allow, next, type Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const SAFE_SUBCOMMANDS = new Set(["add", "list", "move", "remove", "prune", "lock", "unlock", "repair"]);

const allowGitWorktree: Policy = {
  name: "Allow git worktree CRUD",
  description: "Permits git worktree add/list/move/remove/prune/lock/unlock/repair",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return next();
    if (tokens[0] === "git" && tokens[1] === "worktree" && SAFE_SUBCOMMANDS.has(tokens[2])) {
      return allow();
    }
    return next();
  },
};
export default allowGitWorktree;
