import { resolve } from "node:path";
import { isWithinProject, type Policy, type ToolCall } from "../src";
import {
  parseShell,
  getPipelineCommands,
  getArgs,
  isSafeFilter,
  hasUnsafeNodes,
  hasUnsafeRedirects,
} from "./parse-bash-ast";
import { findSearchRoots } from "./allow-bash-find";
import { hasUnsafeDotSegment, resolveHome } from "./safe-dot-paths";

/**
 * Read-only commands xargs may run. Each takes file operands and prints
 * about or from them, the same set allow-safe-read-commands trusts standalone.
 */
const XARGS_READ_COMMANDS = new Set([
  "wc", "cat", "head", "tail", "grep", "egrep", "fgrep", "stat", "file", "du",
]);

/** xargs options that only change batching, parallelism or echoing. */
const XARGS_SAFE_FLAGS = new Set(["-0", "--null", "-r", "--no-run-if-empty", "-t", "--verbose"]);
const XARGS_NUMERIC_FLAGS = new Set(["-n", "--max-args", "-P", "--max-procs"]);
const XARGS_NULL_FLAGS = new Set(["-0", "--null"]);

/**
 * Parse `xargs [opts] <cmd> [args...]`. Returns null on any option outside the
 * safe set — `-I` (substitution), `-a` (args from a file), `-L`, `-E` and the
 * rest are left to a prompt.
 */
function parseXargs(tokens: string[]): { nul: boolean; cmd: string[] } | null {
  if (tokens[0] !== "xargs") return null;
  let nul = false;
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    const t = tokens[i];
    if (XARGS_SAFE_FLAGS.has(t)) {
      if (XARGS_NULL_FLAGS.has(t)) nul = true;
      i++;
    } else if (XARGS_NUMERIC_FLAGS.has(t)) {
      if (!/^\d+$/.test(tokens[i + 1] ?? "")) return null;
      i += 2;
    } else if (/^-[nP]\d+$/.test(t) || /^--max-(args|procs)=\d+$/.test(t)) {
      i++;
    } else {
      return null;
    }
  }
  const cmd = tokens.slice(i);
  if (cmd.length === 0 || !XARGS_READ_COMMANDS.has(cmd[0])) return null;
  return { nul, cmd };
}

/**
 * The fixed operands of the xargs command — the ones written in the command
 * line, before xargs appends the file names. For grep the pattern is not a
 * path; a `-f <file>` pattern source is.
 */
function fixedPathOperands(cmd: string[]): string[] {
  const args = cmd.slice(1);
  if (cmd[0] !== "grep" && cmd[0] !== "egrep" && cmd[0] !== "fgrep") {
    return args.filter((t) => !t.startsWith("-"));
  }

  const paths: string[] = [];
  let patternGiven = args.some((t) => t === "-e" || t.startsWith("--regexp"));
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === "-e") i++;
    else if (t === "-f" || t === "--file") {
      if (args[i + 1] !== undefined) paths.push(args[i + 1]);
      patternGiven = true;
      i++;
    } else if (t.startsWith("--file=")) {
      paths.push(t.slice("--file=".length));
      patternGiven = true;
    } else if (t.startsWith("-")) continue;
    else if (!patternGiven) patternGiven = true;
    else paths.push(t);
  }
  return paths;
}

const SAFE_WORD = /^[\w@%+=:,./-]+$/;

function shellQuote(token: string): string {
  return SAFE_WORD.test(token) ? token : `'${token.replace(/'/g, `'\\''`)}'`;
}

export type FindXargsVerdict =
  | { kind: "allow" }
  | { kind: "needs-null"; suggestion: string };

/**
 * Classify `find ... | xargs <read-only cmd> [| safe filters]`.
 *
 * xargs builds its command at runtime, but in this shape the only runtime
 * part is the list of file operands, and those come from find. Two things
 * could make them dangerous:
 *
 * - An operand read as a flag. find prefixes every path with its root, so no
 *   operand starts with `-` as long as no root does — which findSearchRoots
 *   guarantees, since a leading `-` ends the root list.
 * - Word-splitting. Without `-0`, xargs splits on blanks and honours quotes,
 *   so a file named `x /etc/passwd` becomes two operands. `find -print0 |
 *   xargs -0` splits only on NUL, which no file name can contain.
 *
 * Returns "allow" for the safe shape, "needs-null" when the only thing
 * missing is the NUL delimiting (with a corrected command), and null for
 * anything else, which falls through to a prompt.
 *
 * Like `grep -r`, this reads dot-files beneath an in-project root (`.env`,
 * `.git/`): the dot-segment check covers the roots as written, not what find
 * discovers under them. `-follow` is refused so traversal can't leave the
 * project through a symlinked directory.
 */
export async function classifyFindXargs(call: ToolCall): Promise<FindXargsVerdict | null> {
  if (call.tool !== "Bash") return null;
  if (typeof call.args.command !== "string") return null;
  if (!call.context.projectRoot) return null;

  const ast = await parseShell(call.args.command);
  if (!ast || ast.Stmts.length !== 1) return null;
  const stmt = ast.Stmts[0];
  if (stmt.Background || stmt.Negated) return null;
  if (hasUnsafeNodes(ast)) return null;
  if ((stmt as any).Comments?.length > 0) return null;

  const segments = getPipelineCommands(stmt);
  if (!segments || segments.length < 2) return null;
  if (hasUnsafeRedirects(stmt) || segments.some(hasUnsafeRedirects)) return null;

  const findTokens = getArgs(segments[0]);
  if (!findTokens) return null;
  const roots = findSearchRoots(findTokens);
  if (!roots) return null;
  if (findTokens.includes("-follow")) return null;

  const xargsTokens = getArgs(segments[1]);
  if (!xargsTokens) return null;
  const xargs = parseXargs(xargsTokens);
  if (!xargs) return null;

  const trailing: string[][] = [];
  for (const seg of segments.slice(2)) {
    const args = getArgs(seg);
    if (!args || !isSafeFilter(args)) return null;
    trailing.push(args);
  }

  const cwd = call.context.cwd;
  const inScope = (p: string) => isWithinProject(resolve(cwd, resolveHome(p)), call.context);
  const scopedPaths = [...roots, ...fixedPathOperands(xargs.cmd)];
  if (scopedPaths.some((p) => hasUnsafeDotSegment(p, cwd))) return null;
  if (roots.length === 0 ? !inScope(cwd) : !roots.every(inScope)) return null;
  if (!fixedPathOperands(xargs.cmd).every(inScope)) return null;

  // -print alongside -print0 would mix delimiters; -ls prints a listing, not names.
  const hasPrint0 = findTokens.includes("-print0");
  const hasOtherPrint = findTokens.includes("-print") || findTokens.includes("-ls");
  if (hasPrint0 && !hasOtherPrint && xargs.nul) return { kind: "allow" };
  if (findTokens.includes("-ls")) return null;

  const fixedFind = findTokens.includes("-print")
    ? findTokens.map((t) => (t === "-print" ? "-print0" : t))
    : hasPrint0 ? findTokens : [...findTokens, "-print0"];
  const fixedXargs = xargs.nul ? xargsTokens : ["xargs", "-0", ...xargsTokens.slice(1)];
  const suggestion = [fixedFind, fixedXargs, ...trailing]
    .map((seg) => seg.map(shellQuote).join(" "))
    .join(" | ");
  return { kind: "needs-null", suggestion };
}

const allowFindXargsRead: Policy = {
  name: "Allow find -print0 | xargs -0 read",
  description:
    "Permits `find <in-project roots> ... -print0 | xargs -0 <wc|cat|head|tail|grep|stat|file|du> ...`, optionally piped through safe filters. NUL delimiting means file names can't split into extra operands, and find's root prefix means none can be read as a flag.",
  action: "allow",
  handler: async (call) => {
    const verdict = await classifyFindXargs(call);
    if (verdict?.kind === "allow") return true;
  },
};
export default allowFindXargsRead;
