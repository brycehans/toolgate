import { homedir } from "node:os";
import type { Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs, isSafeFilter } from "./parse-bash-ast";

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
 * Allow `ls` against any path that contains no dot-prefixed segments. The
 * AST parser blocks command substitution, redirects to non-/dev targets,
 * backgrounding, and chaining. Pipelines must consist only of safe filters.
 */
const allowLs: Policy = {
  name: "Allow ls",
  description: "Permits ls against paths with no dot-prefixed segments, optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return;

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds || cmds.length === 0) return;

    const tokens = getArgs(cmds[0]);
    if (!tokens || tokens[0] !== "ls") return;

    for (let i = 1; i < cmds.length; i++) {
      const segArgs = getArgs(cmds[i]);
      if (!segArgs || !isSafeFilter(segArgs)) return;
    }

    const paths = tokens.slice(1).filter((t) => !t.startsWith("-"));
    if (paths.some(hasDotPrefixedSegment)) return;

    return true;
  },
};
export default allowLs;
