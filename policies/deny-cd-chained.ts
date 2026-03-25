import { deny, next, type Policy } from "../src";
import { parseShell, getArgs, Op } from "./parse-bash-ast";
import type { BinaryCmd, Stmt } from "./parse-bash-ast";

function firstCommandIs(stmt: Stmt, name: string): boolean {
  if (!stmt.Cmd) return false;
  if (stmt.Cmd.Type === "CallExpr") {
    const args = getArgs(stmt);
    return args !== null && args[0] === name;
  }
  if (stmt.Cmd.Type === "BinaryCmd") {
    return firstCommandIs((stmt.Cmd as BinaryCmd).X, name);
  }
  return false;
}

/**
 * Deny `cd <path> && <command>` or `cd <path>; <command>` chains.
 * Claude Code preserves the working directory between Bash calls,
 * so cd should be run as a standalone command.
 */
const denyCdChained: Policy = {
  name: "Deny cd chained with other commands",
  description:
    "Rejects cd && ... or cd; ... chains — run cd separately, the working directory persists between calls",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    const cmd = call.args.command;
    if (typeof cmd !== "string") return next();

    const ast = await parseShell(cmd);
    if (!ast) return next();

    // Multiple statements (cd ...; other ...) — check if first is cd
    if (ast.Stmts.length > 1 && firstCommandIs(ast.Stmts[0], "cd")) {
      return deny(
        "Don't chain commands after `cd`. Run `cd <path>` as its own Bash call — the working directory persists between calls.",
      );
    }

    // Single statement that's a BinaryCmd (cd ... && other ...)
    if (ast.Stmts.length === 1 && ast.Stmts[0].Cmd?.Type === "BinaryCmd") {
      const bin = ast.Stmts[0].Cmd as BinaryCmd;
      if (
        (bin.Op === Op.And || bin.Op === Op.Or) &&
        firstCommandIs(bin.X, "cd")
      ) {
        return deny(
          "Don't chain commands after `cd`. Run `cd <path>` as its own Bash call — the working directory persists between calls.",
        );
      }
    }

    return next();
  },
};
export default denyCdChained;
