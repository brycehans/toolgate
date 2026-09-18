import type { Policy } from "../src";
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
  "config", // --global/--system rewrite state outside the repo
  "bundle", // `bundle create <file>` writes to an arbitrary path
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
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] !== "git") return;

    const sub = tokens[1];
    if (!sub) return;

    // A git *global* option (`-c`, `--no-pager`, `--git-dir=`) occupies the
    // subcommand slot, so every check below would inspect the flag instead of
    // the subcommand and wave the real one through. Fail closed rather than
    // skipping past it: `-c` can run arbitrary commands via
    // `diff.external`/`core.sshCommand`, and `--git-dir`/`--work-tree`
    // redirect which repo is touched — both need review in their own right.
    if (sub.startsWith("-")) return;

    if (DESTRUCTIVE_GIT.has(sub)) return;

    const rest = tokens.slice(2);
    if (hasDestructiveFlags(sub, rest)) return;

    return true;
  },
};
export default allowNonDestructiveGit;
