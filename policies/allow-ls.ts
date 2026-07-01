import { homedir } from "node:os";
import type { Policy } from "../src";
import {
  parseShell,
  getPipelineCommands,
  getArgs,
  isSafeFilter,
  type Stmt,
} from "./parse-bash-ast";

const HOME = homedir();

function resolveHome(p: string): string {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return HOME + p.slice(1);
  return p;
}

/**
 * Returns true if the path contains any segment starting with `.` other than
 * `.` (cwd) or `..` (parent). Listing dot-prefixed dirs (`~/.ssh`, `.aws`,
 * `.gnupg`, project `.env` siblings, etc.) tends to reveal secrets or
 * tooling state the user hasn't opted into sharing.
 */
function hasDotPrefixedSegment(path: string): boolean {
  const expanded = resolveHome(path);
  for (const seg of expanded.split("/")) {
    if (seg === "" || seg === "." || seg === "..") continue;
    if (seg.startsWith(".")) return true;
  }
  return false;
}

/**
 * Validate a single statement as a safe `ls` (optionally piped through safe
 * filters): first command must be `ls`, every downstream pipe segment must be
 * a safe filter, and no listed path may contain a dot-prefixed segment.
 */
function isAllowableLsStmt(stmt: Stmt): boolean {
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
  if (paths.some(hasDotPrefixedSegment)) return false;

  return true;
}

/**
 * Allow `ls` against any path that contains no dot-prefixed segments. The
 * AST parser blocks command substitution, redirects to non-/dev targets,
 * backgrounding, and chaining. Pipelines must consist only of safe filters.
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
  description: "Permits ls (or ;-separated ls sequences) against paths with no dot-prefixed segments, optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length === 0) return;

    for (const stmt of ast.Stmts) {
      if (!isAllowableLsStmt(stmt)) return;
    }

    return true;
  },
};
export default allowLs;
