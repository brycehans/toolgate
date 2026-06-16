import { resolve } from "node:path";
import { isWithinProject, type Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs, isSafeFilter, wordToString, Op } from "./parse-bash-ast";
import type { Stmt } from "./parse-bash-ast";

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
  "jq",
  "fx",
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

/**
 * Extract file paths from jq arguments, skipping flags and the filter expression.
 * jq usage: jq [flags] <filter> [file...]
 * The first non-flag positional arg is the filter expression; the rest are file paths.
 */
function getJqFilePaths(tokens: string[]): string[] {
  const paths: string[] = [];
  let filterSeen = false;
  // Flags that consume the next argument
  const flagsWithArg = new Set([
    "--arg", "--argjson", "--slurpfile", "--rawfile",
    "--jsonargs", "--args", "-f", "--from-file",
    "--indent", "--tab",
  ]);
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (flagsWithArg.has(t)) {
      i += 2; // skip flag and its value
    } else if (t.startsWith("-")) {
      i++;
    } else if (!filterSeen) {
      filterSeen = true;
      i++;
    } else {
      paths.push(t);
      i++;
    }
  }
  return paths;
}

/**
 * Extract file paths from `<` stdin-redirect targets on the first pipeline segment.
 * Other redirect ops (`>`, `>>`, etc.) are ignored here — write redirects are handled
 * by the separate deny-writes-outside-project policy. This function exists so the
 * in-project containment check covers `cmd < file` reads as well as positional args.
 */
function getStdinRedirectPaths(stmt: Stmt): string[] {
  const paths: string[] = [];
  if (!stmt.Redirs) return paths;
  for (const r of stmt.Redirs) {
    if (r.Op !== Op.RdrIn) continue;
    const target = wordToString(r.Word);
    if (target) paths.push(target);
  }
  return paths;
}

function isInProject(path: string, cwd: string, context: { projectRoot: string; additionalDirs: string[] }): boolean {
  const resolved = resolve(cwd, path);
  return isWithinProject(resolved, context);
}

const allowSafeReadCommands: Policy = {
  name: "Allow safe read commands in project",
  description: "Permits read-only commands (cat, head, tail, wc, etc.) when all file paths are within the project root",
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
    if (!tokens || !SAFE_READ_COMMANDS.has(tokens[0])) return;

    // sed: reject in-place editing
    if (tokens[0] === "sed") {
      for (const t of tokens) {
        if (t === "-i" || t.startsWith("-i") || t === "--in-place" || t.startsWith("--in-place="))
          return;
      }
    }

    // All subsequent pipeline segments must be safe filters
    for (let i = 1; i < cmds.length; i++) {
      const segArgs = getArgs(cmds[i]);
      if (!segArgs || !isSafeFilter(segArgs)) return;
    }

    const positionalPaths = tokens[0] === "sed"
      ? getSedFilePaths(tokens)
      : tokens[0] === "jq"
      ? getJqFilePaths(tokens)
      : tokens.slice(1).filter((t) => !t.startsWith("-"));

    // Also gate on `<` redirect targets so `cmd < file` is constrained the same as `cmd file`.
    const redirectPaths = getStdinRedirectPaths(ast.Stmts[0]);
    const paths = [...positionalPaths, ...redirectPaths];

    // No file args — allowed only if cwd is in project
    if (paths.length === 0) {
      return isInProject(call.context.cwd, call.context.cwd, call.context)
        ? true
        : undefined;
    }

    const allInProject = paths.every((p) => isInProject(p, call.context.cwd, call.context));
    return allInProject ? true : undefined;
  },
};
export default allowSafeReadCommands;
