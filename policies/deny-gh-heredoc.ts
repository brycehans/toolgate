import type { Policy } from "../src";
import { parseShell, hasUnsafeNodes, Op } from "./parse-bash-ast";
import type { ShellFile } from "./parse-bash-ast";

/**
 * Deny gh/git commands that use command substitution or heredoc redirects
 * (typically for multi-line bodies or commit messages). Instructs Claude to
 * write content to a tmp/ file in the project first, then use
 * --body-file / --input / -F, which is safer (no shell escaping issues)
 * and reviewable via the Write tool.
 */

function hasHeredocRedirects(ast: ShellFile): boolean {
  for (const stmt of ast.Stmts) {
    if (stmt.Redirs) {
      for (const r of stmt.Redirs) {
        if (r.Op === Op.Hdoc || r.Op === Op.DashHdoc) return true;
      }
    }
  }
  return false;
}

const denyGhHeredoc: Policy = {
  name: "Deny gh/git heredoc/command substitution",
  description:
    "Rejects gh/git commands containing $(…) or heredoc redirects — use Write tool + --body-file, --input, or -F instead",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    const command = call.args.command;
    if (typeof command !== "string") return;

    // Quick check: must involve gh or git
    if (!command.includes("gh ") && !command.includes("git ")) return;

    const ast = await parseShell(command);
    if (!ast) return;

    // Deny if the AST contains unsafe nodes (CmdSubst, ParamExp, etc.)
    // or heredoc redirects (<< / <<-)
    if (!hasUnsafeNodes(ast) && !hasHeredocRedirects(ast)) return;

    if (command.includes("git ")) {
      return (
        "Do not use command substitution or heredocs in git commands. " +
        "Instead, write the message to a file in the project's tmp/ directory with the Write tool, " +
        "then use `git commit -F tmp/<file>` or `git tag -F tmp/<file>`. " +
        "Clean up with `rm tmp/<file>` afterwards. " +
        "This avoids shell escaping issues and lets the user review the content first."
      );
    }

    return (
      "Do not use command substitution or heredocs in gh commands. " +
      "Instead, write the body to a file in the project's tmp/ directory with the Write tool, " +
      "then use `gh pr comment --body-file tmp/<file>`, `gh issue comment --body-file tmp/<file>`, " +
      "or `gh api --input tmp/<file>`. Clean up with `rm tmp/<file>` afterwards. " +
      "This avoids shell escaping issues and lets the user review the content first."
    );
  },
};
export default denyGhHeredoc;
