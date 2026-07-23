import { resolve } from "node:path";
import { homedir } from "node:os";
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
  // Flags that consume TWO following args (name + value / name + file)
  const flagsWithTwoArgs = new Set([
    "--arg", "--argjson", "--slurpfile", "--rawfile",
  ]);
  // Flags that consume the next single argument
  const flagsWithArg = new Set([
    "--jsonargs", "--args", "-f", "--from-file",
    "--indent", "--tab",
  ]);
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (flagsWithTwoArgs.has(t)) {
      i += 3; // skip flag and both of its values
    } else if (flagsWithArg.has(t)) {
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

const HOME = homedir();

/**
 * Expand a leading `~`/`~/` or `$HOME`/`${HOME}` to the real home directory.
 * Without this, a token like `~/.aws/credentials` is treated as a literal
 * relative path and `resolve(cwd, "~/.aws/credentials")` lands *inside* the
 * project — so the containment check wrongly passes while the shell would
 * expand `~` to $HOME at runtime and read the real file. (Mirrors allow-ls.)
 */
function resolveHome(p: string): string {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return HOME + p.slice(1);
  if (p === "$HOME" || p === "${HOME}") return HOME;
  if (p.startsWith("$HOME/")) return HOME + p.slice(5);
  if (p.startsWith("${HOME}/")) return HOME + p.slice(7);
  return p;
}

/**
 * Returns true if any path segment starts with `.` (other than `.`/`..`).
 * Reading dot-prefixed files (`~/.ssh/id_rsa`, `.aws/credentials`, `.env`,
 * `.git/config`) tends to expose secrets or tooling state the user hasn't
 * opted into sharing, so these fall through to a prompt. (Mirrors allow-ls.)
 */
function hasDotPrefixedSegment(path: string): boolean {
  const expanded = resolveHome(path);
  for (const seg of expanded.split("/")) {
    if (seg === "" || seg === "." || seg === "..") continue;
    if (seg.startsWith(".")) return true;
  }
  return false;
}

function isInProject(path: string, cwd: string, context: { projectRoot: string; additionalDirs: string[] }): boolean {
  const resolved = resolve(cwd, resolveHome(path));
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
      : tokens[0] === "jq" || tokens[0] === "fx"
      ? getJqFilePaths(tokens) // fx shares jq's shape: first positional is the filter, rest are files
      : tokens.slice(1).filter((t) => !t.startsWith("-"));

    // Also gate on `<` redirect targets so `cmd < file` is constrained the same as `cmd file`.
    const redirectPaths = getStdinRedirectPaths(ast.Stmts[0]);
    const paths = [...positionalPaths, ...redirectPaths];

    // Reject reads of dot-prefixed files (secrets/tooling state) — even inside
    // the project. Catches `cat ~/.aws/credentials`, `cat .env`, `head .git/config`.
    if (paths.some(hasDotPrefixedSegment)) return;

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
