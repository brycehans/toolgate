import { resolve } from "node:path";
import type { Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs, isSafeFilter } from "./parse-bash-ast";

const GREP_COMMANDS = new Set(["grep", "egrep", "fgrep", "rg"]);

const allowBashGrepInProject: Policy = {
  name: "Allow bash grep in project",
  description: "Permits grep/egrep/fgrep/rg commands when all paths are within the project root",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;
    if (!call.context.projectRoot) return;

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return;

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds || cmds.length === 0) return;

    const tokens = getArgs(cmds[0]);
    if (!tokens || !GREP_COMMANDS.has(tokens[0])) return;

    // For rg specifically, reject flags that execute commands or read arbitrary files
    if (tokens[0] === "rg") {
      const blockedExact = [
        "--pre", "--preprocessor", "--pre-glob", "--hostname-bin",
        "-z", "--search-zip",
        "-f", "--file", "--ignore-file",
      ];
      const blockedPrefix = [
        "--pre=", "--preprocessor=", "--pre-glob=", "--hostname-bin=",
        "--file=", "--ignore-file=",
      ];
      for (const t of tokens.slice(1)) {
        if (blockedExact.includes(t)) return;
        if (blockedPrefix.some((p) => t.startsWith(p))) return;
      }
    }

    // All subsequent pipeline segments must be safe filters
    for (let i = 1; i < cmds.length; i++) {
      const segArgs = getArgs(cmds[i]);
      if (!segArgs || !isSafeFilter(segArgs)) return;
    }

    const root = call.context.projectRoot;

    // Extract non-flag arguments as potential paths
    const nonFlags = tokens.slice(1).filter((t) => !t.startsWith("-"));

    // With no path args, grep reads stdin or cwd — allow if cwd is in project
    if (nonFlags.length === 0) {
      if (call.context.cwd.startsWith(root + "/") || call.context.cwd === root) {
        return true;
      }
      return;
    }

    // First non-flag is the pattern; rest are file/dir paths
    const paths = nonFlags.slice(1);

    // No explicit paths — defaults to cwd
    if (paths.length === 0) {
      if (call.context.cwd.startsWith(root + "/") || call.context.cwd === root) {
        return true;
      }
      return;
    }

    const allInProject = paths.every((p) => {
      const resolved = resolve(call.context.cwd, p);
      return resolved === root || resolved.startsWith(root + "/");
    });

    return allInProject ? true : undefined;
  },
};
export default allowBashGrepInProject;
