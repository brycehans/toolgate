import type { Policy } from "../src";
import { parseShell, type Word, type WordPart, type Lit, type SglQuoted, type DblQuoted } from "./parse-bash-ast";

/**
 * Whether a git argument is the `--output` diff-machinery flag. Backslashes
 * are stripped first because the shell drops them (`\--output=x` reaches git
 * as `--output=x`) while the AST keeps them in the literal. Every shorter
 * prefix of `--output` is ambiguous with `--output-indicator-*`, which git
 * rejects, so only the full flag needs matching.
 */
export function isGitOutputFlag(token: string): boolean {
  return /^--output(=|$)/.test(token.replace(/\\/g, ""));
}

/**
 * The literal text a word starts with, up to its first non-literal part.
 * `"--output=$HOME/x"` has no constant value, but its prefix `--output=` is
 * still enough to recognise the flag.
 */
function literalPrefix(word: Word): string {
  let out = "";
  const visit = (parts: WordPart[]): boolean => {
    for (const p of parts) {
      if (p.Type === "Lit") out += (p as Lit).Value;
      else if (p.Type === "SglQuoted") out += (p as SglQuoted).Value;
      else if (p.Type === "DblQuoted") {
        if (!visit((p as DblQuoted).Parts ?? [])) return false;
      } else return false;
    }
    return true;
  };
  visit(word.Parts ?? []);
  return out;
}

/**
 * Finds `--output` on any command line that names git before it — anywhere in
 * the AST, including subshells, pipelines and `env git ...` wrappers. Matching
 * any earlier `git` argument rather than only argv[0] over-matches on purpose:
 * a rare false deny is cheaper than a missed write.
 */
function hasGitOutputFlag(node: any): boolean {
  if (Array.isArray(node)) return node.some(hasGitOutputFlag);
  if (!node || typeof node !== "object") return false;

  if (node.Type === "CallExpr" && Array.isArray(node.Args)) {
    let sawGit = false;
    for (const arg of node.Args as Word[]) {
      const prefix = literalPrefix(arg);
      if (sawGit && isGitOutputFlag(prefix)) return true;
      if (prefix.replace(/\\/g, "") === "git") sawGit = true;
    }
  }

  for (const key in node) {
    if (hasGitOutputFlag(node[key])) return true;
  }
  return false;
}

const MESSAGE =
  "Do not use `git --output=<file>`. It writes outside the containment check, and truncates the target even when git prints to stdout instead. Redirect instead — `git show <rev>:<path> > <file>` — so the write target is checked.";

/**
 * Deny git's `--output` flag. It is a diff-machinery flag accepted by show,
 * log and diff, and it creates and truncates the target — even when git
 * prints its content to stdout instead. The write never reaches
 * deny-writes-outside-project, which inspects shell redirects rather than a
 * command's own flags, so the containment check is bypassed entirely.
 *
 * The AST check sees through quoting and escaping (`"--output=x"`,
 * `\--output=x`) that the regex can't. The regex stays as a fallback for
 * input shfmt refuses to parse.
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

    const ast = await parseShell(cmd);
    if (ast) return hasGitOutputFlag(ast) ? MESSAGE : undefined;

    // Unparseable: fall back to text. No pipe, semicolon or & between `git`
    // and the flag, so `git log | pandoc --output=x` is left alone.
    if (/\bgit\b[^|;&]*\s--output(=|\s|$)/.test(cmd)) return MESSAGE;
  },
};
export default denyGitOutputFlag;
