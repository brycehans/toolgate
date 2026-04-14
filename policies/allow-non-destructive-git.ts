import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

/**
 * Git subcommands that are destructive or mutate remote state.
 * Everything NOT in this set falls through to allow().
 */
const DESTRUCTIVE_GIT = new Set([
  "push",
  "reset",
  "clean",
  "rebase",
  "merge",
  "cherry-pick",
  "revert",
  "rm",
  "mv",
  "filter-branch",
  "replace",
  "gc",
  "prune",
  "reflog",
  "bisect",
  "submodule",
  "worktree", // handled by allow-git-worktree with finer control
]);

/** Flags on otherwise-safe subcommands that make them destructive. */
function hasDestructiveFlags(sub: string, rest: string[]): boolean {
  if (sub === "checkout" && rest.includes(".")) return true;
  if (sub === "checkout" && rest.includes("--")) {
    const afterDash = rest.slice(rest.indexOf("--") + 1);
    if (afterDash.includes(".")) return true;
  }
  if (sub === "restore" && !rest.includes("--staged")) return true;
  if (sub === "stash" && (rest.includes("drop") || rest.includes("clear")))
    return true;
  if (sub === "branch") {
    if (
      rest.some((t) =>
        ["-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy", "-f", "--force"].includes(t)
      )
    )
      return true;
  }
  if (sub === "tag") {
    if (rest.some((t) => ["-d", "--delete", "-f", "--force"].includes(t)))
      return true;
  }
  return false;
}

const allowNonDestructiveGit: Policy = {
  name: "Allow non-destructive git",
  description:
    "Auto-approves git commands that don't mutate remote state or discard uncommitted work",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] !== "git") return next();

    const sub = tokens[1];
    if (!sub) return next();

    if (DESTRUCTIVE_GIT.has(sub)) return next();

    const rest = tokens.slice(2);
    if (hasDestructiveFlags(sub, rest)) return next();

    return allow();
  },
};
export default allowNonDestructiveGit;
