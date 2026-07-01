import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const SAFE_SUBCOMMANDS = new Set(["add", "list", "move", "remove", "prune", "lock", "unlock", "repair"]);

const allowGitWorktree: Policy = {
  name: "Allow git worktree CRUD",
  description: "Permits git worktree add/list/move/remove/prune/lock/unlock/repair",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return;
    if (tokens[0] === "git" && tokens[1] === "worktree" && SAFE_SUBCOMMANDS.has(tokens[2])) {
      return true;
    }
    return;
  },
};
export default allowGitWorktree;
