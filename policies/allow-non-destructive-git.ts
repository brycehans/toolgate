import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

/**
 * Git subcommands that only read repository state. Everything NOT in this set
 * falls through to a prompt.
 *
 * Mutating subcommands are not listed here even when they are routinely safe —
 * `add`, `commit`, `stash`, `worktree`, `checkout -b` and `fetch` each have
 * their own policy, which is where the argument for allowing them belongs.
 */
export const READ_ONLY_GIT = new Set([
  "status",
  "log",
  "show",
  "diff",
  "grep",
  "blame",
  "ls-tree",
  "ls-files",
  "ls-remote",
  "for-each-ref",
  "show-ref",
  "rev-parse",
  "rev-list",
  "merge-base",
  "name-rev",
  "describe",
  "shortlog",
  "cat-file",
  "diff-tree",
  "diff-files",
  "diff-index",
  "remote",
]);

/** `git remote` arguments that list remotes rather than rewriting them. */
const READ_ONLY_REMOTE_ARGS = new Set(["-v", "--verbose", "show", "get-url"]);

/** Uses of a read-only subcommand that are not, in fact, read-only. */
export function isUnsafeUse(sub: string, rest: string[]): boolean {
  // `git grep -O<cmd>` runs <cmd> on every matched file — the same arbitrary
  // execution escape as `-c diff.external`, and it needs no TTY.
  if (sub === "grep") {
    return rest.some(
      (t) => t.startsWith("-O") || t.startsWith("--open-files-in-pager")
    );
  }

  if (sub === "remote") {
    return rest.length > 0 && !READ_ONLY_REMOTE_ARGS.has(rest[0]!);
  }

  return false;
}

const allowNonDestructiveGit: Policy = {
  name: "Allow non-destructive git",
  description:
    "Auto-approves git subcommands that only read repository state; anything else prompts",
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

    if (!READ_ONLY_GIT.has(sub)) return;

    if (isUnsafeUse(sub, tokens.slice(2))) return;

    return true;
  },
};
export default allowNonDestructiveGit;
