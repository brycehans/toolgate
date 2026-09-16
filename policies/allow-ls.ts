import type { Policy } from "../src";
import {
  parseShell,
  getPipelineCommands,
  getArgs,
  isSafeFilter,
  type Stmt,
} from "./parse-bash-ast";
import { hasUnsafeDotSegment } from "./safe-dot-paths";

/**
 * Validate a single statement as a safe `ls` (optionally piped through safe
 * filters): first command must be `ls`, every downstream pipe segment must be
 * a safe filter, and no listed path may reach into an undeclared dot-prefixed
 * directory.
 */
function isAllowableLsStmt(stmt: Stmt, cwd: string): boolean {
  if (stmt.Background || stmt.Negated) return false;

  const cmds = getPipelineCommands(stmt);
  if (!cmds || cmds.length === 0) return false;

  const tokens = getArgs(cmds[0]);
  if (!tokens || tokens[0] !== "ls") return false;

  for (let i = 1; i < cmds.length; i++) {
    const segArgs = getArgs(cmds[i]);
    if (!segArgs || !isSafeFilter(segArgs)) return false;
  }

  const paths = tokens.slice(1).filter((t) => !t.startsWith("-"));
  if (paths.some((p) => hasUnsafeDotSegment(p, cwd))) return false;

  return true;
}

/**
 * Allow `ls` against any path that stays clear of undeclared dot-prefixed
 * directories (see `safe-dot-paths`). The AST parser blocks command
 * substitution, redirects to non-/dev targets, backgrounding, and chaining.
 * Pipelines must consist only of safe filters.
 *
 * A `;`-separated sequence (e.g. `ls a; ls b`) is allowed when EVERY statement
 * is independently a safe `ls`. Each `ls` is a side-effect-free read with no
 * precondition on the others, so the `&&`-vs-`;` failure-propagation
 * distinction is moot — the same reasoning that lets `Allow pure command
 * chains` compose pure commands applies here. Any non-`ls` statement in the
 * sequence (e.g. `ls; echo pwned`) fails the whole match and falls through.
 */
const allowLs: Policy = {
  name: "Allow ls",
  description: "Permits ls (or ;-separated ls sequences) against paths clear of undeclared dot-prefixed directories, optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length === 0) return;

    for (const stmt of ast.Stmts) {
      if (!isAllowableLsStmt(stmt, call.context.cwd)) return;
    }

    return true;
  },
};
export default allowLs;
