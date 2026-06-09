import type { ToolCall } from "../src";
import { allow, next, type Policy } from "../src";
import {
  Op,
  type BinaryCmd,
  type Stmt,
  getArgs,
  hasUnsafeNodes,
  isSafeFilter,
  parseShell,
  wordToString,
} from "./parse-bash-ast";
import { matchesTestRunner } from "./_test-runners";

/**
 * Permit `(cd <path> && <test-runner>)` and pipelined variants. The subshell
 * confines the cd to the child shell so the parent cwd is unchanged, and the
 * inner command is constrained to a known test runner.
 *
 * Accepted shapes (where TR is a known test runner; F is a safe filter like
 * head/tail/grep; R is a safe redirect like 2>&1):
 *
 *   (cd X && TR [R])
 *   (cd X && TR [R] | F [| F]...)
 *   (cd X && TR [R]) | F [| F]...
 */

const SAFE_REDIRECT_TARGETS = new Set(["/dev/null", "/dev/stderr", "/dev/stdout"]);

function hasOnlySafeRedirects(stmt: Stmt): boolean {
  if (!stmt.Redirs) return true;
  for (const r of stmt.Redirs) {
    if (r.Op === Op.DplOut) continue; // 2>&1
    if (r.N) {
      const target = wordToString(r.Word);
      if (target && SAFE_REDIRECT_TARGETS.has(target)) continue;
    }
    return false;
  }
  return true;
}

function isCleanStmt(stmt: Stmt): boolean {
  if (stmt.Background) return false;
  if (stmt.Negated) return false;
  if ((stmt as any).Comments?.length > 0) return false;
  if (!hasOnlySafeRedirects(stmt)) return false;
  return true;
}

/**
 * Walk a pipeline from the leftmost end. The leaf must be a CallExpr; all
 * intermediate right-hand sides must be safe filters. Returns the leaf args,
 * or null if the shape is invalid.
 */
function extractPipelineLeaf(stmt: Stmt): string[] | null {
  if (!isCleanStmt(stmt)) return null;
  let cur: Stmt = stmt;
  while (cur.Cmd?.Type === "BinaryCmd") {
    const bin = cur.Cmd as BinaryCmd;
    if (bin.Op !== Op.Pipe) return null;
    if (!isCleanStmt(bin.Y)) return null;
    const rightArgs = getArgs(bin.Y);
    if (!rightArgs || !isSafeFilter(rightArgs)) return null;
    cur = bin.X;
  }
  if (cur.Cmd?.Type !== "CallExpr") return null;
  if (!isCleanStmt(cur)) return null;
  return getArgs(cur);
}

interface SubshellWithFilters {
  subshellStmts: Stmt[];
}

/**
 * Walk the outermost statement: zero or more pipes to safe filters, with a
 * Subshell at the leftmost leaf.
 */
function extractOuterSubshell(stmt: Stmt): SubshellWithFilters | null {
  if (!isCleanStmt(stmt)) return null;
  let cur: Stmt = stmt;
  while (cur.Cmd?.Type === "BinaryCmd") {
    const bin = cur.Cmd as BinaryCmd;
    if (bin.Op !== Op.Pipe) return null;
    if (!isCleanStmt(bin.Y)) return null;
    const rightArgs = getArgs(bin.Y);
    if (!rightArgs || !isSafeFilter(rightArgs)) return null;
    cur = bin.X;
  }
  const cmd = cur.Cmd as any;
  if (!cmd || cmd.Type !== "Subshell") return null;
  if (!isCleanStmt(cur)) return null;
  if (!Array.isArray(cmd.Stmts)) return null;
  return { subshellStmts: cmd.Stmts };
}

function isCdStmt(stmt: Stmt): boolean {
  if (!isCleanStmt(stmt)) return false;
  if (stmt.Cmd?.Type !== "CallExpr") return false;
  const args = getArgs(stmt);
  if (!args) return false;
  // `cd <path>` — exactly one positional path argument, no flags.
  if (args.length !== 2) return false;
  if (args[0] !== "cd") return false;
  if (args[1].startsWith("-")) return false;
  return true;
}

async function check(call: ToolCall): Promise<boolean> {
  if (call.tool !== "Bash") return false;
  const command = call.args?.command;
  if (typeof command !== "string") return false;

  const file = await parseShell(command);
  if (!file) return false;
  if (file.Stmts.length !== 1) return false;
  // Reject any unsafe nodes anywhere in the tree (command/param/process subst).
  if (hasUnsafeNodes(file)) return false;

  const outer = extractOuterSubshell(file.Stmts[0]);
  if (!outer) return false;
  if (outer.subshellStmts.length !== 1) return false;

  const inner = outer.subshellStmts[0];
  if (!isCleanStmt(inner)) return false;
  if (inner.Cmd?.Type !== "BinaryCmd") return false;
  const bin = inner.Cmd as BinaryCmd;
  if (bin.Op !== Op.And) return false;

  // Left: cd <path>
  if (!isCdStmt(bin.X)) return false;

  // Right: test runner, optionally piped to safe filters.
  const leafArgs = extractPipelineLeaf(bin.Y);
  if (!leafArgs) return false;
  return matchesTestRunner(leafArgs);
}

const allowSubshellCdTest: Policy = {
  name: "Allow (cd && test) subshell",
  description:
    "Permits `(cd <path> && <test-runner>)` and pipelined variants — the subshell isolates the cd so cwd is unchanged",
  handler: async (call) => {
    return (await check(call)) ? allow() : next();
  },
};

export default allowSubshellCdTest;
