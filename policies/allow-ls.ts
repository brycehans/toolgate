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
 * Only a single statement is considered. `ls a; ls b` (or the same on two
 * lines) is denied by `Deny chained commands` before any allow runs, so a
 * multi-statement match here could never be reached.
 */
const allowLs: Policy = {
  name: "Allow ls",
  description: "Permits ls against paths clear of undeclared dot-prefixed directories, optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return;

    if (!isAllowableLsStmt(ast.Stmts[0], call.context.cwd)) return;

    return true;
  },
};
export default allowLs;
