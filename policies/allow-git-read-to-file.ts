import type { Policy } from "../src";
import { Op, getArgs, hasUnsafeNodes, parseShell, wordToString } from "./parse-bash-ast";

const READ_SUBCOMMANDS = new Set(["show", "log", "diff"]);

/**
 * Permit a read-only git command that redirects its output to a file.
 *
 * The existing allows for these subcommands go through
 * `safeBashCommandOrPipeline`, which treats any `> file` as unsafe and bails,
 * so capturing a blob or a diff prompts. The redirect is the only risk-bearing
 * half, and deny-writes-outside-project resolves and containment-checks every
 * `>`/`>>` target before any allow policy runs — so this cannot widen the
 * write surface past the project root and its additional directories.
 *
 * It *can* be widened by a target the deny layer declines to check: an
 * unresolvable word is skipped there rather than denied, so every redirect
 * target has to flatten to a constant string here. `&>` is likewise rejected,
 * because findWriteRedirects only collects `>` and `>>`.
 */
const allowGitReadToFile: Policy = {
  name: "Allow git read redirected to a file",
  description:
    "Permits git log/show/diff writing its output to a file — the target is containment-checked by the deny layer",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    const cmd = call.args.command;
    if (typeof cmd !== "string") return;

    const file = await parseShell(cmd);
    if (!file || file.Stmts.length !== 1) return;

    const stmt = file.Stmts[0];
    if (stmt.Background || stmt.Negated) return;
    if (hasUnsafeNodes(file)) return;

    const tokens = getArgs(stmt);
    if (!tokens || tokens[0] !== "git") return;
    if (!tokens[1] || !READ_SUBCOMMANDS.has(tokens[1])) return;

    const redirs = stmt.Redirs ?? [];
    if (redirs.length === 0) return;

    for (const r of redirs) {
      if (r.Op !== Op.RdrOut && r.Op !== Op.AppOut) return;
      if (wordToString(r.Word) === null) return;
    }

    return true;
  },
};
export default allowGitReadToFile;
