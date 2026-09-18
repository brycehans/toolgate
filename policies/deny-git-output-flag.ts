import type { Policy } from "../src";

/**
 * Deny git's `--output` flag. It is a diff-machinery flag accepted by show,
 * log and diff, and it creates and truncates the target — even when git
 * prints its content to stdout instead. The write never reaches
 * deny-writes-outside-project, which inspects shell redirects rather than a
 * command's own flags, so the containment check is bypassed entirely.
 *
 * Matched by regex rather than by AST so that it fires regardless of command
 * shape: the AST helpers bail out on the redirect and pipeline forms this flag
 * most often appears in, and a missed write is costlier than a rare prompt.
 */
const denyGitOutputFlag: Policy = {
  name: "Deny git --output",
  description:
    "Rejects git commands using --output — use a shell redirect so the write target is containment-checked",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    const cmd = call.args.command;
    if (typeof cmd !== "string") return;

    // No pipe, semicolon or & between `git` and the flag, so `git log |
    // pandoc --output=x` is left alone.
    if (/\bgit\b[^|;&]*\s--output(=|\s|$)/.test(cmd)) {
      return "Do not use `git --output=<file>`. It writes outside the containment check, and truncates the target even when git prints to stdout instead. Redirect instead — `git show <rev>:<path> > <file>` — so the write target is checked.";
    }
  },
};
export default denyGitOutputFlag;
