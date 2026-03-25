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

const SHFMT_PATH = `${process.env.HOME}/go/bin/shfmt`;

export async function parseShell(
  command: string,
): Promise<ShellFile | null> {
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
      if (dbl.Parts.length === 1 && dbl.Parts[0].Type === "Lit") {
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

export function getArgs(stmt: Stmt): string[] | null {
  const cmd = stmt.Cmd;
  if (!cmd || cmd.Type !== "CallExpr") return null;
  const call = cmd as CallExpr;
  // Reject commands with env var assignments (e.g. GIT_DIR=. git add .)
  if ((call as any).Assigns && (call as any).Assigns.length > 0) return null;
  const result: string[] = [];
  for (const arg of call.Args) {
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
]);

export function isSafeFilter(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const cmd = tokens[0];

  if (UNCONDITIONALLY_SAFE.has(cmd)) return true;

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

export function findTeeTargets(file: ShellFile): string[] {
  const targets: string[] = [];
  for (const stmt of file.Stmts) {
    walkStmts(stmt, (s) => {
      if (!s.Cmd || s.Cmd.Type !== "CallExpr") return;
      const call = s.Cmd as CallExpr;
      const args = call.Args;
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

export function findGitSubcommands(file: ShellFile): string[] {
  const subcommands: string[] = [];
  for (const stmt of file.Stmts) {
    walkStmts(stmt, (s) => {
      if (!s.Cmd || s.Cmd.Type !== "CallExpr") return;
      const call = s.Cmd as CallExpr;
      const args = call.Args;
      if (args.length < 2) return;
      const cmdName = wordToString(args[0]);
      if (cmdName !== "git") return;
      const sub = wordToString(args[1]);
      if (sub !== null) subcommands.push(sub);
    });
  }
  return subcommands;
}
