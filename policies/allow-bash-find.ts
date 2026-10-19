import { resolve } from "node:path";
import { homedir } from "node:os";
import type { Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs, isSafeFilter } from "./parse-bash-ast";
import { hasUnsafeDotSegment, resolveHome } from "./safe-dot-paths";

const HOME = homedir();

function isUnderHome(path: string, cwd: string): string | null {
  const expanded = resolveHome(path);
  const resolved = resolve(cwd, expanded);
  if (resolved === HOME || resolved.startsWith(HOME + "/")) return resolved;
  return null;
}

/**
 * find primaries and options that only select or print. Anything that runs a
 * command (-exec, -ok, -execdir), deletes (-delete) or writes a file
 * (-fprint*, -fls) is absent, so it fails the check.
 */
const FIND_SAFE_FLAGS = new Set([
  "-print", "-print0", "-ls",
  "-name", "-iname", "-path", "-ipath", "-regex", "-iregex",
  "-type", "-size", "-empty", "-newer", "-perm", "-user", "-group",
  "-mtime", "-atime", "-ctime", "-mmin", "-amin", "-cmin",
  "-readable", "-writable", "-executable",
  "-maxdepth", "-mindepth",
  "-not", "-and", "-or", "-a", "-o", "!",
  "-follow", "-xdev", "-mount", "-daystart",
  "-true", "-false", "-prune",
]);

/**
 * Validate a `find` argv and return its search roots (empty when find
 * defaults to the cwd), or null if any flag is outside FIND_SAFE_FLAGS or the
 * expression uses parentheses.
 */
export function findSearchRoots(tokens: string[]): string[] | null {
  if (tokens[0] !== "find") return null;

  for (const t of tokens.slice(1)) {
    if (t.startsWith("-") && !FIND_SAFE_FLAGS.has(t)) return null;
    if (t === "(" || t === ")" || t === "\\(" || t === "\\)") return null;
  }

  const roots: string[] = [];
  for (const arg of tokens.slice(1)) {
    if (arg.startsWith("-") || arg === "!" || arg === "(") break;
    roots.push(arg);
  }
  return roots;
}

/**
 * Allow `find` when all search paths resolve to somewhere under $HOME and stay
 * clear of undeclared dot-prefixed directories (see `safe-dot-paths`) — without
 * that second check, `find ~/.ssh` enumerates what `ls ~/.ssh` is refused.
 * Dangerous flags (-exec, -delete, -ok, -fprint*, etc.) are rejected at the
 * AST level. Pipelines must consist only of safe filters.
 */
const allowBashFind: Policy = {
  name: "Allow bash find",
  description: "Permits find commands when all search paths are under $HOME and clear of undeclared dot-prefixed directories",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return;

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds) return;

    const tokens = getArgs(cmds[0]);
    if (!tokens) return;
    const paths = findSearchRoots(tokens);
    if (!paths) return;

    for (let i = 1; i < cmds.length; i++) {
      const args = getArgs(cmds[i]);
      if (!args || !isSafeFilter(args)) return;
    }

    if (paths.length === 0) {
      return isUnderHome(call.context.cwd, call.context.cwd) ? true : undefined;
    }

    if (paths.some((p) => hasUnsafeDotSegment(p, call.context.cwd))) return;

    const allUnderHome = paths.every((p) => isUnderHome(p, call.context.cwd) !== null);
    return allUnderHome ? true : undefined;
  },
};
export default allowBashFind;
