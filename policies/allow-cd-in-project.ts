import { homedir } from "node:os";
import { resolve } from "node:path";
import { allow, next, isWithinProject, type Policy } from "../src";
import { parseShell, getArgs } from "./parse-bash-ast";

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

const allowCdInProject: Policy = {
  name: "Allow cd within project",
  description:
    "Permits standalone cd commands when the target is within the project root",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();
    if (!call.context.projectRoot) return next();

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return next();

    const args = getArgs(ast.Stmts[0]);
    if (!args || args[0] !== "cd") return next();

    const root = call.context.projectRoot;

    // bare `cd` (goes to home) — not in project
    if (args.length === 1) return next();

    // resolve the target path relative to cwd, expanding ~ first
    const target = resolve(call.context.cwd, expandTilde(args[1]));
    return isWithinProject(target, call.context) ? allow() : next();
  },
};
export default allowCdInProject;
