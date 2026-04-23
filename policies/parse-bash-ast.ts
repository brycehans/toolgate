import type { ToolCall } from "../src";

// Op code constants from shfmt AST
export const Op = {
  And: 11,
  Or: 12,
  Pipe: 13,
  PipeAll: 14,
  RdrOut: 63,
  AppOut: 64,
  RdrIn: 65,
  DplOut: 68,
  RdrAll: 74,
  Hdoc: 71,
  DashHdoc: 72,
} as const;

// AST Types

export interface ShellFile {
  Type: "File";
  Stmts: Stmt[];
}

export interface Stmt {
  Cmd: Command | null;
  Redirs?: Redirect[];
  Negated?: boolean;
  Background?: boolean;
}

export type Command = CallExpr | BinaryCmd | { Type: string };

export interface CallExpr {
  Type: "CallExpr";
  Args: Word[];
}

export interface BinaryCmd {
  Type: "BinaryCmd";
  Op: number;
  X: Stmt;
  Y: Stmt;
}

export interface Word {
  Parts: WordPart[];
}

export type WordPart =
  | Lit
  | SglQuoted
  | DblQuoted
  | CmdSubst
  | ParamExp
  | { Type: string };

export interface Lit {
  Type: "Lit";
  Value: string;
}

export interface SglQuoted {
  Type: "SglQuoted";
  Value: string;
}

export interface DblQuoted {
  Type: "DblQuoted";
  Parts: WordPart[];
}

export interface CmdSubst {
  Type: "CmdSubst";
  Stmts: Stmt[];
  Backquotes?: boolean;
}

export interface ParamExp {
  Type: "ParamExp";
  Param: { Value: string };
}

export interface Redirect {
  Op: number;
  N: { Value: string } | null;
  Word: Word;
}

// Core parser

function findShfmt(): string | null {
  const candidates = [
    `${process.env.HOME}/go/bin/shfmt`,
    "/usr/local/bin/shfmt",
    "/opt/homebrew/bin/shfmt",
  ];
  for (const p of candidates) {
    if (Bun.file(p).size) return p;
  }
  // Fall back to PATH lookup
  try {
    const result = Bun.spawnSync(["which", "shfmt"], { stdout: "pipe", stderr: "pipe" });
    const path = new TextDecoder().decode(result.stdout).trim();
    if (result.exitCode === 0 && path) return path;
  } catch {}
  return null;
}

const SHFMT_PATH = findShfmt();

let _shfmtWarned = false;
function warnMissingShfmt(): void {
  if (_shfmtWarned) return;
  _shfmtWarned = true;
  console.error(
    "[toolgate] WARNING: shfmt not found. Bash AST parsing is disabled — all Bash commands will prompt for permission.\n" +
    "  Install: go install mvdan.cc/sh/v3/cmd/shfmt@latest\n" +
    "  Or:      brew install shfmt",
  );
}

export async function parseShell(
  command: string,
): Promise<ShellFile | null> {
  if (!SHFMT_PATH) {
    warnMissingShfmt();
    return null;
  }
  try {
    const proc = Bun.spawn([SHFMT_PATH, "--tojson"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(command);
    proc.stdin.end();
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return JSON.parse(output) as ShellFile;
  } catch {
    return null;
  }
}

// AST query helpers

export function wordToString(word: Word): string | null {
  const parts = word.Parts;
  if (parts.length === 0) return null;

  if (parts.length === 1) {
    const p = parts[0];
    if (p.Type === "Lit") return (p as Lit).Value;
    if (p.Type === "SglQuoted") return (p as SglQuoted).Value;
    if (p.Type === "DblQuoted") {
      const dbl = p as DblQuoted;
      if (!dbl.Parts || dbl.Parts.length === 0) return "";
      if (dbl.Parts.length === 1 && dbl.Parts[0].Type === "Lit") {
        return (dbl.Parts[0] as Lit).Value;
      }
      return null;
    }
    return null;
  }

  // Multi-part: each part must resolve to a string
  const values: string[] = [];
  for (const p of parts) {
    if (p.Type === "Lit") {
      values.push((p as Lit).Value);
    } else if (p.Type === "SglQuoted") {
      values.push((p as SglQuoted).Value);
    } else if (p.Type === "DblQuoted") {
      const dbl = p as DblQuoted;
      if (!dbl.Parts || dbl.Parts.length === 0) {
        values.push("");
      } else if (dbl.Parts.length === 1 && dbl.Parts[0].Type === "Lit") {
        values.push((dbl.Parts[0] as Lit).Value);
      } else {
        return null;
      }
    } else {
      return null;
    }
  }
  return values.join("");
}

/** Env var assignments that are safe to ignore (benign prefixes). */
const SAFE_ASSIGNS = new Set(["CI"]);

function hasUnsafeAssigns(cmd: any): boolean {
  if (!cmd.Assigns || cmd.Assigns.length === 0) return false;
  return cmd.Assigns.some((a: any) => !SAFE_ASSIGNS.has(a.Name?.Value));
}

export function getArgs(stmt: Stmt): string[] | null {
  const cmd = stmt.Cmd;
  if (!cmd || cmd.Type !== "CallExpr") return null;
  const call = cmd as CallExpr;
  // Reject commands with env var assignments (e.g. GIT_DIR=. git add .)
  // unless every assign is in the safe list (e.g. CI=)
  if (hasUnsafeAssigns(call)) return null;
  const result: string[] = [];
  for (const arg of call.Args ?? []) {
    const s = wordToString(arg);
    if (s === null) return null;
    result.push(s);
  }
  return result;
}

const SAFE_REDIRECT_TARGETS = new Set([
  "/dev/null",
  "/dev/stderr",
  "/dev/stdout",
]);

export function isSimpleCommand(file: ShellFile): boolean {
  if (file.Stmts.length !== 1) return false;
  const stmt = file.Stmts[0];
  if (!stmt.Cmd || stmt.Cmd.Type !== "CallExpr") return false;

  if (stmt.Redirs) {
    for (const r of stmt.Redirs) {
      // fd-to-fd duplications are always OK (e.g. 2>&1)
      if (r.Op === Op.DplOut) continue;

      // fd-prefixed redirects to safe targets are OK (e.g. 2>/dev/null)
      if (r.N) {
        const target = wordToString(r.Word);
        if (target && SAFE_REDIRECT_TARGETS.has(target)) continue;
      }

      // Everything else (bare > file, etc.) is not simple
      return false;
    }
  }

  return true;
}

export function getPipelineCommands(stmt: Stmt): Stmt[] | null {
  const cmd = stmt.Cmd;
  if (!cmd) return null;

  if (cmd.Type === "CallExpr") {
    return [stmt];
  }

  if (cmd.Type === "BinaryCmd") {
    const bin = cmd as BinaryCmd;
    if (bin.Op !== Op.Pipe) return null;
    const left = getPipelineCommands(bin.X);
    if (!left) return null;
    const right = getPipelineCommands(bin.Y);
    if (!right) return null;
    return [...left, ...right];
  }

  return null;
}

const UNSAFE_NODE_TYPES = new Set([
  "CmdSubst",
  "ParamExp",
  "ArithmExp",
  "ProcSubst",
]);

export function hasUnsafeNodes(obj: any): boolean {
  if (obj === null || obj === undefined) return false;
  if (typeof obj !== "object") return false;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (hasUnsafeNodes(item)) return true;
    }
    return false;
  }

  if (typeof obj.Type === "string" && UNSAFE_NODE_TYPES.has(obj.Type)) {
    return true;
  }

  for (const key of Object.keys(obj)) {
    if (hasUnsafeNodes(obj[key])) return true;
  }
  return false;
}

export interface RedirectInfo {
  op: number;
  target: string | null;
  fd: string | null;
}

function collectRedirects(stmt: Stmt, out: RedirectInfo[]): void {
  if (stmt.Redirs) {
    for (const r of stmt.Redirs) {
      out.push({
        op: r.Op,
        target: wordToString(r.Word),
        fd: r.N ? r.N.Value : null,
      });
    }
  }

  if (stmt.Cmd && stmt.Cmd.Type === "BinaryCmd") {
    const bin = stmt.Cmd as BinaryCmd;
    collectRedirects(bin.X, out);
    collectRedirects(bin.Y, out);
  }
}

export function getRedirects(file: ShellFile): RedirectInfo[] {
  const result: RedirectInfo[] = [];
  for (const stmt of file.Stmts) {
    collectRedirects(stmt, result);
  }
  return result;
}

// High-level policy helpers

export async function safeBashCommand(
  call: ToolCall,
): Promise<string[] | null> {
  if (call.tool !== "Bash") return null;
  const command = call.args?.command;
  if (typeof command !== "string") return null;

  const file = await parseShell(command);
  if (!file) return null;
  if (!isSimpleCommand(file)) return null;

  const stmt = file.Stmts[0];
  if (stmt.Background) return null;
  if (stmt.Negated) return null;
  if (hasUnsafeNodes(file)) return null;
  // Reject commands with comments (could hide payloads)
  if ((stmt as any).Comments && (stmt as any).Comments.length > 0) return null;

  return getArgs(stmt);
}

function hasUnsafeRedirects(stmt: Stmt): boolean {
  if (stmt.Redirs) {
    for (const r of stmt.Redirs) {
      if (r.Op === Op.DplOut) continue;
      if (r.N) {
        const target = wordToString(r.Word);
        if (target && SAFE_REDIRECT_TARGETS.has(target)) continue;
      }
      return true;
    }
  }
  return false;
}

export async function safeBashCommandOrPipeline(
  call: ToolCall,
): Promise<string[] | null> {
  if (call.tool !== "Bash") return null;
  const command = call.args?.command;
  if (typeof command !== "string") return null;

  const file = await parseShell(command);
  if (!file) return null;
  if (file.Stmts.length !== 1) return null;

  const stmt = file.Stmts[0];
  if (stmt.Background) return null;
  if (stmt.Negated) return null;
  if (hasUnsafeNodes(file)) return null;
  // Reject commands with comments (could hide payloads)
  if ((stmt as any).Comments && (stmt as any).Comments.length > 0) return null;

  if (!stmt.Cmd) return null;

  // Simple CallExpr
  if (stmt.Cmd.Type === "CallExpr") {
    if (hasUnsafeRedirects(stmt)) return null;
    return getArgs(stmt);
  }

  // Pipeline
  const segments = getPipelineCommands(stmt);
  if (!segments) return null;

  // Check redirects on all segments
  for (const seg of segments) {
    if (hasUnsafeRedirects(seg)) return null;
  }
  // Also check top-level redirects
  if (hasUnsafeRedirects(stmt)) return null;

  // First segment args
  const firstArgs = getArgs(segments[0]);
  if (!firstArgs) return null;

  // All subsequent segments must be safe filters
  for (let i = 1; i < segments.length; i++) {
    const segArgs = getArgs(segments[i]);
    if (!segArgs) return null;
    if (!isSafeFilter(segArgs)) return null;
  }

  return firstArgs;
}

const UNCONDITIONALLY_SAFE = new Set([
  "grep",
  "egrep",
  "fgrep",
  "head",
  "tail",
  "wc",
  "cat",
  "tr",
  "cut",
  "file",
  "stat",
  "du",
  "diff",
  "jq",
  "fx",
  "gron",
]);

export function isSafeFilter(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const cmd = tokens[0];

  if (UNCONDITIONALLY_SAFE.has(cmd)) return true;

  if (cmd === "sed") {
    for (const t of tokens) {
      if (t === "-i" || t.startsWith("-i") || t === "--in-place" || t.startsWith("--in-place="))
        return false;
    }
    return true;
  }

  if (cmd === "sort") {
    for (const t of tokens) {
      if (t === "-o" || t === "--output" || t.startsWith("--output="))
        return false;
    }
    return true;
  }

  if (cmd === "uniq") {
    // Non-flag args (not starting with -) must be <= 1 (the input file)
    const nonFlags = tokens.slice(1).filter((t) => !t.startsWith("-"));
    return nonFlags.length <= 1;
  }

  return false;
}

export interface WriteRedirectInfo {
  target: string | null;
  fd: string | null;
}

export function findWriteRedirects(file: ShellFile): WriteRedirectInfo[] {
  const allRedirects = getRedirects(file);
  const result: WriteRedirectInfo[] = [];
  for (const r of allRedirects) {
    // Only RdrOut and AppOut
    if (r.op !== Op.RdrOut && r.op !== Op.AppOut) continue;
    // Exclude DplOut (already filtered by op check above)
    // Exclude safe targets
    if (r.target && SAFE_REDIRECT_TARGETS.has(r.target)) continue;
    result.push({ target: r.target, fd: r.fd });
  }
  return result;
}

function walkStmts(stmt: Stmt, fn: (s: Stmt) => void): void {
  fn(stmt);
  if (stmt.Cmd && stmt.Cmd.Type === "BinaryCmd") {
    const bin = stmt.Cmd as BinaryCmd;
    walkStmts(bin.X, fn);
    walkStmts(bin.Y, fn);
  }
}

/**
 * Decompose a && chain into its leaf CallExpr statements.
 * Returns null if:
 * - Multiple statements (semicolons)
 * - Any operator other than Op.And (||, pipes)
 * - Any leaf is not a CallExpr
 * - Any segment has unsafe redirects, unsafe nodes, assignments, or comments
 * - Background or negated execution
 *
 * Single commands (no &&) return a single-element array for uniform handling.
 * Safe redirects (2>&1, 2>/dev/null) are allowed within segments.
 */
export function getAndChainSegments(file: ShellFile): Stmt[] | null {
  if (file.Stmts.length !== 1) return null;

  const stmt = file.Stmts[0];
  if (stmt.Background) return null;
  if (stmt.Negated) return null;
  if ((stmt as any).Comments?.length > 0) return null;

  const cmd = stmt.Cmd;
  if (!cmd) return null;

  // Single simple command — wrap for uniform handling
  if (cmd.Type === "CallExpr") {
    if (hasUnsafeNodes(cmd)) return null;
    if (hasUnsafeRedirects(stmt)) return null;
    if (hasUnsafeAssigns(cmd)) return null;
    return [stmt];
  }

  // Must be a BinaryCmd — walk the tree
  if (cmd.Type !== "BinaryCmd") return null;

  const segments: Stmt[] = [];
  if (!collectAndLeaves(cmd as BinaryCmd, segments)) return null;
  return segments;
}

function collectAndLeaves(bin: BinaryCmd, out: Stmt[]): boolean {
  // Only allow && operator — reject ||, pipes, etc.
  if (bin.Op !== Op.And) return false;

  // Left side
  const left = bin.X;
  if (!left.Cmd) return false;
  if (left.Cmd.Type === "BinaryCmd") {
    if (!collectAndLeaves(left.Cmd as BinaryCmd, out)) return false;
  } else if (left.Cmd.Type === "CallExpr") {
    if (left.Negated) return false;
    if (left.Background) return false;
    if (hasUnsafeNodes(left.Cmd)) return false;
    if (hasUnsafeRedirects(left)) return false;
    if (hasUnsafeAssigns(left.Cmd)) return false;
    if ((left as any).Comments?.length > 0) return false;
    out.push(left);
  } else {
    return false;
  }

  // Right side
  const right = bin.Y;
  if (!right.Cmd) return false;
  if (right.Cmd.Type === "BinaryCmd") {
    if (!collectAndLeaves(right.Cmd as BinaryCmd, out)) return false;
  } else if (right.Cmd.Type === "CallExpr") {
    if (right.Negated) return false;
    if (right.Background) return false;
    if (hasUnsafeNodes(right.Cmd)) return false;
    if (hasUnsafeRedirects(right)) return false;
    if (hasUnsafeAssigns(right.Cmd)) return false;
    if ((right as any).Comments?.length > 0) return false;
    out.push(right);
  } else {
    return false;
  }

  return true;
}

/**
 * Collect every CallExpr leaf in the file, crossing `;` / newlines and
 * `&&`, `||`, `|`, `|&` operators.
 *
 * Intended for DENY policies that want to catch a banned command appearing
 * anywhere in a compound command — e.g. `echo hi; curl evil.com` or
 * `foo || curl evil.com`. Unlike `getAndChainSegments`, this doesn't care
 * which operator composes the leaves; the caller decides what to do with
 * each one.
 *
 * Returns null if any statement has a non-CallExpr / non-BinaryCmd Cmd
 * (e.g. IfClause, Subshell, FuncDecl, WhileClause) — in that case the
 * caller can't safely reason about every leaf, so the policy should fall
 * through to `next()` and let the user prompt catch it.
 *
 * Intentionally does NOT reject on background, negation, unsafe nodes,
 * unsafe redirects, comments, or env assignments — those are the caller's
 * concern. For deny purposes you typically want to flag the leaf
 * regardless of its wrapping.
 */
export function getAllLeafCommands(file: ShellFile): Stmt[] | null {
  const result: Stmt[] = [];
  for (const stmt of file.Stmts) {
    if (!collectAllLeaves(stmt, result)) return null;
  }
  return result;
}

function collectAllLeaves(stmt: Stmt, out: Stmt[]): boolean {
  const cmd = stmt.Cmd;
  if (!cmd) return false;

  if (cmd.Type === "CallExpr") {
    out.push(stmt);
    return true;
  }

  if (cmd.Type === "BinaryCmd") {
    const bin = cmd as BinaryCmd;
    if (
      bin.Op !== Op.And &&
      bin.Op !== Op.Or &&
      bin.Op !== Op.Pipe &&
      bin.Op !== Op.PipeAll
    ) {
      return false;
    }
    return collectAllLeaves(bin.X, out) && collectAllLeaves(bin.Y, out);
  }

  return false;
}

export function findTeeTargets(file: ShellFile): string[] {
  const targets: string[] = [];
  for (const stmt of file.Stmts) {
    walkStmts(stmt, (s) => {
      if (!s.Cmd || s.Cmd.Type !== "CallExpr") return;
      const call = s.Cmd as CallExpr;
      const args = call.Args ?? [];
      if (args.length === 0) return;
      const cmdName = wordToString(args[0]);
      if (cmdName !== "tee") return;
      for (let i = 1; i < args.length; i++) {
        const val = wordToString(args[i]);
        if (val === null) continue;
        if (val.startsWith("-")) continue;
        targets.push(val);
      }
    });
  }
  return targets;
}

const WRITE_COMMANDS = new Set(["cp", "mv", "install"]);

/**
 * Find destination paths of file-writing commands (cp, mv, install).
 * Returns the last non-flag positional argument of each matching command,
 * which is the destination/target path.
 */
export function findWriteCommandTargets(file: ShellFile): string[] {
  const targets: string[] = [];
  for (const stmt of file.Stmts) {
    walkStmts(stmt, (s) => {
      if (!s.Cmd || s.Cmd.Type !== "CallExpr") return;
      const call = s.Cmd as CallExpr;
      const args = call.Args ?? [];
      if (args.length < 3) return; // need at least: cmd src dest
      const cmdName = wordToString(args[0]);
      if (!cmdName || !WRITE_COMMANDS.has(cmdName)) return;
      // Last argument is the destination
      const lastArg = args[args.length - 1];
      const val = wordToString(lastArg);
      if (val !== null && !val.startsWith("-")) {
        targets.push(val);
      }
    });
  }
  return targets;
}

/**
 * Commands that are provably side-effect-free:
 * - No filesystem writes
 * - No environment or cwd mutation
 * - No network activity
 * - No code execution (except parse-only modes like php -l)
 *
 * The value is either null (any args allowed) or a Set of
 * required first arguments (subcommand/flag constraints).
 */
export const PURE_COMMANDS: Map<string, Set<string> | null> = new Map([
  ["php", new Set(["-l"])], // lint mode only — parses, never executes
  ["echo", null], // stdout only (redirects rejected by AST layer)
  ["test", null], // evaluates conditions, no side effects
  ["true", null], // always succeeds, no side effects
  ["false", null], // always fails, no side effects
  ["pwd", null], // prints cwd, no side effects
  ["sleep", null], // waits, no side effects
]);

export function isPureCommand(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const constraint = PURE_COMMANDS.get(tokens[0]);
  if (constraint === undefined) return false; // command not in allowlist
  if (constraint === null) return true; // any args allowed
  return tokens.length > 1 && constraint.has(tokens[1]); // required subcommand
}

export function findGitSubcommands(file: ShellFile): string[] {
  const subcommands: string[] = [];
  for (const stmt of file.Stmts) {
    walkStmts(stmt, (s) => {
      if (!s.Cmd || s.Cmd.Type !== "CallExpr") return;
      const call = s.Cmd as CallExpr;
      const args = call.Args ?? [];
      if (args.length < 2) return;
      const cmdName = wordToString(args[0]);
      if (cmdName !== "git") return;
      const sub = wordToString(args[1]);
      if (sub !== null) subcommands.push(sub);
    });
  }
  return subcommands;
}
