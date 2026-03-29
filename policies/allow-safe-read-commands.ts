import { resolve } from "node:path";
import { allow, next, type Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs, isSafeFilter } from "./parse-bash-ast";

/**
 * Read-only commands safe to run standalone on files within the project.
 * These overlap with UNCONDITIONALLY_SAFE filters but are allowed here
 * as the primary command, not just as pipe destinations.
 */
const SAFE_READ_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "wc",
  "tr",
  "cut",
  "file",
  "stat",
  "du",
  "diff",
  "sed",
]);

/**
 * Extract file paths from sed arguments, skipping flags and the script expression.
 * sed usage: sed [flags] [-e script]... [-f file]... [script] [file...]
 */
function getSedFilePaths(tokens: string[]): string[] {
  const paths: string[] = [];
  let i = 1;
  let scriptSeen = false;

  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "-e" || t === "--expression") {
      scriptSeen = true;
      i += 2; // skip flag and its argument
    } else if (t.startsWith("-e") || t.startsWith("--expression=")) {
      scriptSeen = true;
      i++;
    } else if (t === "-f" || t === "--file") {
      scriptSeen = true;
      i += 2;
    } else if (t.startsWith("-f") || t.startsWith("--file=")) {
      scriptSeen = true;
      i++;
    } else if (t.startsWith("-")) {
      i++;
    } else if (!scriptSeen) {
      // First non-flag, non -e/-f argument is the inline script
      scriptSeen = true;
      i++;
    } else {
      paths.push(t);
      i++;
    }
  }
  return paths;
}

function isInProject(path: string, cwd: string, root: string): boolean {
  const resolved = resolve(cwd, path);
  return resolved === root || resolved.startsWith(root + "/");
}

const allowSafeReadCommands: Policy = {
  name: "Allow safe read commands in project",
  description: "Permits read-only commands (cat, head, tail, wc, etc.) when all file paths are within the project root",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();
    if (!call.context.projectRoot) return next();

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return next();

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds || cmds.length === 0) return next();

    const tokens = getArgs(cmds[0]);
    if (!tokens || !SAFE_READ_COMMANDS.has(tokens[0])) return next();

    // sed: reject in-place editing
    if (tokens[0] === "sed") {
      for (const t of tokens) {
        if (t === "-i" || t.startsWith("-i") || t === "--in-place" || t.startsWith("--in-place="))
          return next();
      }
    }

    // All subsequent pipeline segments must be safe filters
    for (let i = 1; i < cmds.length; i++) {
      const segArgs = getArgs(cmds[i]);
      if (!segArgs || !isSafeFilter(segArgs)) return next();
    }

    const root = call.context.projectRoot;
    const paths = tokens[0] === "sed"
      ? getSedFilePaths(tokens)
      : tokens.slice(1).filter((t) => !t.startsWith("-"));

    // No file args — allowed only if cwd is in project
    if (paths.length === 0) {
      return isInProject(call.context.cwd, call.context.cwd, root)
        ? allow()
        : next();
    }

    const allInProject = paths.every((p) => isInProject(p, call.context.cwd, root));
    return allInProject ? allow() : next();
  },
};
export default allowSafeReadCommands;
