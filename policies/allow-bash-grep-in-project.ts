import { resolve } from "node:path";
import { allow, next, type Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs, isSafeFilter } from "./parse-bash-ast";

const GREP_COMMANDS = new Set(["grep", "egrep", "fgrep", "rg"]);

const allowBashGrepInProject: Policy = {
  name: "Allow bash grep in project",
  description: "Permits grep/egrep/fgrep/rg commands when all paths are within the project root",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();
    if (!call.context.projectRoot) return next();

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return next();

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds || cmds.length === 0) return next();

    const tokens = getArgs(cmds[0]);
    if (!tokens || !GREP_COMMANDS.has(tokens[0])) return next();

    // All subsequent pipeline segments must be safe filters
    for (let i = 1; i < cmds.length; i++) {
      const segArgs = getArgs(cmds[i]);
      if (!segArgs || !isSafeFilter(segArgs)) return next();
    }

    const root = call.context.projectRoot;

    // Extract non-flag arguments as potential paths
    const nonFlags = tokens.slice(1).filter((t) => !t.startsWith("-"));

    // With no path args, grep reads stdin or cwd — allow if cwd is in project
    if (nonFlags.length === 0) {
      if (call.context.cwd.startsWith(root + "/") || call.context.cwd === root) {
        return allow();
      }
      return next();
    }

    // First non-flag is the pattern; rest are file/dir paths
    const paths = nonFlags.slice(1);

    // No explicit paths — defaults to cwd
    if (paths.length === 0) {
      if (call.context.cwd.startsWith(root + "/") || call.context.cwd === root) {
        return allow();
      }
      return next();
    }

    const allInProject = paths.every((p) => {
      const resolved = resolve(call.context.cwd, p);
      return resolved === root || resolved.startsWith(root + "/");
    });

    return allInProject ? allow() : next();
  },
};
export default allowBashGrepInProject;
