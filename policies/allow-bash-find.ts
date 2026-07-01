import { resolve } from "node:path";
import { homedir } from "node:os";
import type { Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs, isSafeFilter } from "./parse-bash-ast";

const HOME = homedir();

function resolveHome(p: string): string {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return HOME + p.slice(1);
  return p;
}

function isUnderHome(path: string, cwd: string): string | null {
  const expanded = resolveHome(path);
  const resolved = resolve(cwd, expanded);
  if (resolved === HOME || resolved.startsWith(HOME + "/")) return resolved;
  return null;
}

/**
 * Allow `find` when all search paths resolve to somewhere under $HOME.
 * Dangerous flags (-exec, -delete, -ok, -fprint*, etc.) are rejected at the
 * AST level. Pipelines must consist only of safe filters.
 */
const allowBashFind: Policy = {
  name: "Allow bash find",
  description: "Permits find commands when all search paths are under $HOME",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return;

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds) return;

    const tokens = getArgs(cmds[0]);
    if (!tokens || tokens[0] !== "find") return;

    for (let i = 1; i < cmds.length; i++) {
      const args = getArgs(cmds[i]);
      if (!args || !isSafeFilter(args)) return;
    }

    const SAFE_FLAGS = new Set([
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

    for (const t of tokens.slice(1)) {
      if (t.startsWith("-") && !SAFE_FLAGS.has(t)) return;
      if (t === "(" || t === ")" || t === "\\(" || t === "\\)") return;
    }

    const args = tokens.slice(1);
    const paths: string[] = [];
    for (const arg of args) {
      if (arg.startsWith("-") || arg === "!" || arg === "(") break;
      paths.push(arg);
    }

    if (paths.length === 0) {
      return isUnderHome(call.context.cwd, call.context.cwd) ? true : undefined;
    }

    const allUnderHome = paths.every((p) => isUnderHome(p, call.context.cwd) !== null);
    return allUnderHome ? true : undefined;
  },
};
export default allowBashFind;
