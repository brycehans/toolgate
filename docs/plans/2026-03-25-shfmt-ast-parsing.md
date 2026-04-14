# Replace shell-quote with shfmt AST Parsing

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `shell-quote` tokenization with `shfmt --tojson` AST-based parsing for all bash command analysis in policies.

**Architecture:** Shell out to `shfmt --tojson` via `Bun.spawn` (~3ms per call), parse the JSON AST into typed TypeScript structures, then provide high-level query functions that policies use instead of the current `safeBashTokens`/`safeBashPipeline`/`isSafeFilter` API. The new AST makes pipes, redirects, command substitution, and chaining structurally explicit — no more regex metacharacter detection or `shell-quote` operator guessing.

**Tech Stack:** `shfmt` (Go binary, already installed at `~/go/bin/shfmt`), Bun.spawn, TypeScript

**Key insight from spike:** `shfmt --tojson` successfully parsed 155/155 real-world commands from `~/.claude/permission-requests.jsonl`. The AST uses `Type` discriminators (`CallExpr`, `BinaryCmd`, `CmdSubst`, `ParamExp`, etc.) and numeric `Op` codes for operators.

---

## Op Code Reference

```
BinaryCmd ops:  11 = &&, 12 = ||, 13 = |, 14 = |&
Redirect ops:   63 = >, 64 = >>, 65 = <, 68 = >&, 74 = &>
```

A redirect with `N: { Value: "2" }` means the fd-number prefix (e.g., `2>/dev/null` has `Op: 63, N.Value: "2"`). A redirect with `N: null` is a bare `>` or `>>`.

---

### Task 1: Create AST types and shfmt parser

**Files:**
- Create: `policies/parse-bash-ast.ts`
- Test: `policies/tests/parse-bash-ast.test.ts`

This is the foundational module. It exports TypeScript types for the shfmt AST and a `parseShell(command)` function that invokes `shfmt --tojson`.

**Step 1: Write the failing test**

```ts
// policies/tests/parse-bash-ast.test.ts
import { describe, expect, it } from "bun:test";
import { parseShell } from "../parse-bash-ast";

describe("parseShell", () => {
  it("parses a simple command", async () => {
    const ast = await parseShell("git status");
    expect(ast).not.toBeNull();
    expect(ast!.Stmts).toHaveLength(1);
    expect(ast!.Stmts[0].Cmd?.Type).toBe("CallExpr");
  });

  it("parses a pipeline", async () => {
    const ast = await parseShell("git log | head -5");
    expect(ast).not.toBeNull();
    expect(ast!.Stmts[0].Cmd?.Type).toBe("BinaryCmd");
  });

  it("returns null for invalid syntax", async () => {
    const ast = await parseShell("if then fi (((");
    expect(ast).toBeNull();
  });

  it("parses command with redirects", async () => {
    const ast = await parseShell("echo hi > /tmp/out");
    expect(ast).not.toBeNull();
    expect(ast!.Stmts[0].Redirs).toHaveLength(1);
    expect(ast!.Stmts[0].Redirs![0].Op).toBe(63);
  });

  it("parses command substitution", async () => {
    const ast = await parseShell("echo $(whoami)");
    expect(ast).not.toBeNull();
    const call = ast!.Stmts[0].Cmd as any;
    expect(call.Args[1].Parts[0].Type).toBe("CmdSubst");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test policies/tests/parse-bash-ast.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```ts
// policies/parse-bash-ast.ts

// ── Op code constants ──────────────────────────────────────────────
export const Op = {
  // BinaryCmd operators
  And: 11,
  Or: 12,
  Pipe: 13,
  PipeAll: 14,
  // Redirect operators
  RdrOut: 63,    // >
  AppOut: 64,    // >>
  RdrIn: 65,     // <
  DplOut: 68,    // >&
  RdrAll: 74,    // &>
} as const;

// ── AST types ──────────────────────────────────────────────────────
export interface Pos {
  Offset: number;
  Line: number;
  Col: number;
}

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

export type WordPart = Lit | SglQuoted | DblQuoted | CmdSubst | ParamExp | { Type: string };

export interface Word {
  Parts: WordPart[];
}

export interface Redirect {
  Op: number;
  N: { Value: string } | null;
  Word: Word;
}

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

export type Command = CallExpr | BinaryCmd | { Type: string };

export interface Stmt {
  Cmd: Command | null;
  Redirs?: Redirect[];
  Negated?: boolean;
  Background?: boolean;
}

export interface ShellFile {
  Type: "File";
  Stmts: Stmt[];
}

// ── Parser ─────────────────────────────────────────────────────────

let shfmtPath: string | null = null;

function getShfmtPath(): string {
  if (shfmtPath) return shfmtPath;
  // Check common locations
  const candidates = [
    process.env.HOME + "/go/bin/shfmt",
    "/usr/local/bin/shfmt",
    "/opt/homebrew/bin/shfmt",
    "shfmt", // PATH lookup
  ];
  // For now, just use the first one. In production, could probe.
  shfmtPath = candidates[0];
  return shfmtPath;
}

export async function parseShell(command: string): Promise<ShellFile | null> {
  try {
    const proc = Bun.spawn([getShfmtPath(), "--tojson"], {
      stdin: new Response(command).body,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) return null;

    return JSON.parse(stdout) as ShellFile;
  } catch {
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test policies/tests/parse-bash-ast.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add policies/parse-bash-ast.ts policies/tests/parse-bash-ast.test.ts
git commit -m "feat: add shfmt AST parser with types and parseShell function"
```

---

### Task 2: Add AST query helpers

**Files:**
- Modify: `policies/parse-bash-ast.ts`
- Test: `policies/tests/parse-bash-ast.test.ts`

Add helper functions that extract structured info from the AST. These replace the old `safeBashTokens`, `safeBashPipeline`, and `isSafeFilter` with AST-aware equivalents.

**Step 1: Write the failing tests**

Append to `policies/tests/parse-bash-ast.test.ts`:

```ts
import {
  parseShell,
  getArgs,
  wordToString,
  isSimpleCommand,
  getPipelineCommands,
  hasUnsafeNodes,
  getRedirects,
  Op,
} from "../parse-bash-ast";
import type { ToolCall } from "@brycehanscomb/toolgate";

// ... existing parseShell tests ...

describe("wordToString", () => {
  it("extracts literal value", async () => {
    const ast = await parseShell("git log");
    const call = ast!.Stmts[0].Cmd as any;
    expect(wordToString(call.Args[0])).toBe("git");
  });

  it("returns null for word with substitution", async () => {
    const ast = await parseShell("echo $(whoami)");
    const call = ast!.Stmts[0].Cmd as any;
    expect(wordToString(call.Args[1])).toBeNull();
  });

  it("extracts single-quoted value", async () => {
    const ast = await parseShell("echo 'hello world'");
    const call = ast!.Stmts[0].Cmd as any;
    expect(wordToString(call.Args[1])).toBe("hello world");
  });
});

describe("getArgs", () => {
  it("returns string args for simple command", async () => {
    const ast = await parseShell("git log --oneline -5");
    const args = getArgs(ast!.Stmts[0]);
    expect(args).toEqual(["git", "log", "--oneline", "-5"]);
  });

  it("returns null for non-CallExpr", async () => {
    const ast = await parseShell("git log | head");
    expect(getArgs(ast!.Stmts[0])).toBeNull();
  });

  it("returns null if any arg has substitution", async () => {
    const ast = await parseShell("git add $(whoami)");
    expect(getArgs(ast!.Stmts[0])).toBeNull();
  });
});

describe("isSimpleCommand", () => {
  it("returns true for single command, no redirects", async () => {
    const ast = await parseShell("git status");
    expect(isSimpleCommand(ast!)).toBe(true);
  });

  it("returns false for pipeline", async () => {
    const ast = await parseShell("git log | head");
    expect(isSimpleCommand(ast!)).toBe(false);
  });

  it("returns false for multiple statements", async () => {
    const ast = await parseShell("ls; echo hi");
    expect(isSimpleCommand(ast!)).toBe(false);
  });

  it("returns true for command with fd redirect", async () => {
    const ast = await parseShell("ls 2>/dev/null");
    expect(isSimpleCommand(ast!)).toBe(true);
  });

  it("returns false for command with file redirect", async () => {
    const ast = await parseShell("echo hi > /tmp/out");
    expect(isSimpleCommand(ast!)).toBe(false);
  });
});

describe("getPipelineCommands", () => {
  it("returns statements for a pipeline", async () => {
    const ast = await parseShell("git log | grep fix | head -5");
    const cmds = getPipelineCommands(ast!.Stmts[0]);
    expect(cmds).toHaveLength(3);
    expect(getArgs(cmds![0])).toEqual(["git", "log"]);
    expect(getArgs(cmds![1])).toEqual(["grep", "fix"]);
    expect(getArgs(cmds![2])).toEqual(["head", "-5"]);
  });

  it("returns single-element array for simple command", async () => {
    const ast = await parseShell("git status");
    const cmds = getPipelineCommands(ast!.Stmts[0]);
    expect(cmds).toHaveLength(1);
  });

  it("returns null for && chain", async () => {
    const ast = await parseShell("git add . && git commit");
    expect(getPipelineCommands(ast!.Stmts[0])).toBeNull();
  });
});

describe("hasUnsafeNodes", () => {
  it("returns false for all-literal args", async () => {
    const ast = await parseShell("git log --oneline");
    expect(hasUnsafeNodes(ast!)).toBe(false);
  });

  it("returns true for command substitution", async () => {
    const ast = await parseShell("echo $(whoami)");
    expect(hasUnsafeNodes(ast!)).toBe(true);
  });

  it("returns true for backtick substitution", async () => {
    const ast = await parseShell("echo `id`");
    expect(hasUnsafeNodes(ast!)).toBe(true);
  });

  it("returns true for parameter expansion", async () => {
    const ast = await parseShell("echo ${HOME}");
    expect(hasUnsafeNodes(ast!)).toBe(true);
  });

  it("returns false for single-quoted strings with special chars", async () => {
    const ast = await parseShell("grep -E '(foo|bar)'");
    expect(hasUnsafeNodes(ast!)).toBe(false);
  });
});

describe("getRedirects", () => {
  it("returns file redirects", async () => {
    const ast = await parseShell("echo hi > /tmp/out");
    const redirs = getRedirects(ast!);
    expect(redirs).toHaveLength(1);
    expect(redirs[0].op).toBe(Op.RdrOut);
    expect(redirs[0].target).toBe("/tmp/out");
    expect(redirs[0].fd).toBeNull();
  });

  it("returns fd redirect with fd number", async () => {
    const ast = await parseShell("ls 2>/dev/null");
    const redirs = getRedirects(ast!);
    expect(redirs).toHaveLength(1);
    expect(redirs[0].op).toBe(Op.RdrOut);
    expect(redirs[0].target).toBe("/dev/null");
    expect(redirs[0].fd).toBe("2");
  });

  it("returns dup redirect", async () => {
    const ast = await parseShell("cmd 2>&1");
    const redirs = getRedirects(ast!);
    expect(redirs).toHaveLength(1);
    expect(redirs[0].op).toBe(Op.DplOut);
    expect(redirs[0].fd).toBe("2");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test policies/tests/parse-bash-ast.test.ts`
Expected: FAIL — functions not exported

**Step 3: Write the implementation**

Add to `policies/parse-bash-ast.ts`:

```ts
// ── Word helpers ───────────────────────────────────────────────────

/** Extract a plain string from a Word, or null if it contains expansions/substitutions. */
export function wordToString(word: Word): string | null {
  if (word.Parts.length === 1) {
    const part = word.Parts[0];
    if (part.Type === "Lit") return part.Value;
    if (part.Type === "SglQuoted") return (part as SglQuoted).Value;
    if (part.Type === "DblQuoted") {
      const dbl = part as DblQuoted;
      if (dbl.Parts.length === 1 && dbl.Parts[0].Type === "Lit") {
        return (dbl.Parts[0] as Lit).Value;
      }
      return null;
    }
    return null;
  }
  // Multi-part word: all parts must be Lit (adjacent literals happen with escapes)
  const pieces: string[] = [];
  for (const part of word.Parts) {
    if (part.Type === "Lit") pieces.push((part as Lit).Value);
    else return null;
  }
  return pieces.join("");
}

// ── Statement helpers ──────────────────────────────────────────────

/**
 * Extract string arguments from a Stmt whose Cmd is a CallExpr.
 * Returns null if the Cmd is not a CallExpr or any argument contains
 * expansions/substitutions.
 */
export function getArgs(stmt: Stmt): string[] | null {
  if (!stmt.Cmd || stmt.Cmd.Type !== "CallExpr") return null;
  const call = stmt.Cmd as CallExpr;
  const args: string[] = [];
  for (const word of call.Args) {
    const s = wordToString(word);
    if (s === null) return null;
    args.push(s);
  }
  return args;
}

/**
 * Check if a ShellFile represents a single simple command (one statement,
 * CallExpr, no file redirects — fd-to-fd and fd-to-devnull redirects are OK).
 */
export function isSimpleCommand(file: ShellFile): boolean {
  if (file.Stmts.length !== 1) return false;
  const stmt = file.Stmts[0];
  if (!stmt.Cmd || stmt.Cmd.Type !== "CallExpr") return false;
  // Check redirects: only allow fd-to-fd (DplOut) and fd-prefixed redirects to /dev/null
  if (stmt.Redirs) {
    for (const r of stmt.Redirs) {
      if (r.Op === Op.DplOut) continue; // 2>&1 is fine
      if (r.N !== null) {
        // fd-prefixed redirect like 2>/dev/null
        const target = wordToString(r.Word);
        if (target === "/dev/null" || target === "/dev/stderr" || target === "/dev/stdout") continue;
      }
      return false; // file redirect without fd, or non-safe target
    }
  }
  return true;
}

/**
 * Flatten a pipe-only BinaryCmd tree into a list of Stmt nodes.
 * Returns null if any BinaryCmd in the tree is not a pipe (|).
 * For a simple CallExpr, returns a single-element array.
 */
export function getPipelineCommands(stmt: Stmt): Stmt[] | null {
  if (!stmt.Cmd) return null;
  if (stmt.Cmd.Type === "CallExpr") return [stmt];
  if (stmt.Cmd.Type !== "BinaryCmd") return null;
  const bin = stmt.Cmd as BinaryCmd;
  if (bin.Op !== Op.Pipe) return null;
  const left = getPipelineCommands(bin.X);
  const right = getPipelineCommands(bin.Y);
  if (!left || !right) return null;
  return [...left, ...right];
}

/**
 * Check if any node in the AST contains unsafe expansions:
 * CmdSubst ($() or backticks), ParamExp (${VAR}), or other expansion types.
 */
export function hasUnsafeNodes(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (obj.Type === "CmdSubst" || obj.Type === "ParamExp" ||
      obj.Type === "ArithmExp" || obj.Type === "ProcSubst") {
    return true;
  }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      if (v.some(hasUnsafeNodes)) return true;
    } else if (hasUnsafeNodes(v)) return true;
  }
  return false;
}

/** Structured redirect info */
export interface RedirectInfo {
  op: number;
  target: string | null;
  fd: string | null;
}

/** Collect all redirects from all statements in a file, recursively. */
export function getRedirects(file: ShellFile): RedirectInfo[] {
  const results: RedirectInfo[] = [];
  function collectFromStmt(stmt: Stmt) {
    if (stmt.Redirs) {
      for (const r of stmt.Redirs) {
        results.push({
          op: r.Op,
          target: wordToString(r.Word),
          fd: r.N?.Value ?? null,
        });
      }
    }
    // Recurse into BinaryCmd
    if (stmt.Cmd?.Type === "BinaryCmd") {
      const bin = stmt.Cmd as BinaryCmd;
      collectFromStmt(bin.X);
      collectFromStmt(bin.Y);
    }
  }
  for (const stmt of file.Stmts) {
    collectFromStmt(stmt);
  }
  return results;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test policies/tests/parse-bash-ast.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add policies/parse-bash-ast.ts policies/tests/parse-bash-ast.test.ts
git commit -m "feat: add AST query helpers (getArgs, getPipelineCommands, etc.)"
```

---

### Task 3: Add high-level policy helpers

**Files:**
- Modify: `policies/parse-bash-ast.ts`
- Test: `policies/tests/parse-bash-ast.test.ts`

Add the top-level functions that policies will actually call — replacements for `safeBashTokens`, `safeBashTokensOrPipeline`, and the redirect-checking logic. These compose the lower-level helpers from Task 2.

**Step 1: Write the failing tests**

Append to `policies/tests/parse-bash-ast.test.ts`:

```ts
import {
  // ... existing imports ...
  safeBashCommand,
  safeBashCommandOrPipeline,
  findWriteRedirects,
  findTeeTargets,
  isSafeFilter,
  findGitSubcommands,
} from "../parse-bash-ast";

describe("safeBashCommand", () => {
  function bash(command: string): ToolCall {
    return { tool: "Bash", args: { command }, context: { cwd: "/tmp", env: {}, projectRoot: null } };
  }

  it("returns args for simple command", async () => {
    expect(await safeBashCommand(bash("git status"))).toEqual(["git", "status"]);
  });

  it("returns args with flags", async () => {
    expect(await safeBashCommand(bash("git log --oneline -5"))).toEqual(["git", "log", "--oneline", "-5"]);
  });

  it("strips 2>&1", async () => {
    expect(await safeBashCommand(bash("bun test 2>&1"))).toEqual(["bun", "test"]);
  });

  it("strips 2>/dev/null", async () => {
    expect(await safeBashCommand(bash("ls 2>/dev/null"))).toEqual(["ls"]);
  });

  it("returns null for pipeline", async () => {
    expect(await safeBashCommand(bash("ls | head"))).toBeNull();
  });

  it("returns null for && chain", async () => {
    expect(await safeBashCommand(bash("git add . && rm -rf /"))).toBeNull();
  });

  it("returns null for command substitution", async () => {
    expect(await safeBashCommand(bash("git add $(whoami)"))).toBeNull();
  });

  it("returns null for non-Bash tool", async () => {
    const call: ToolCall = { tool: "Read", args: {}, context: { cwd: "/tmp", env: {}, projectRoot: null } };
    expect(await safeBashCommand(call)).toBeNull();
  });

  it("returns null for multiline commands", async () => {
    // shfmt parses multiline as multiple statements
    expect(await safeBashCommand(bash("git add .\ngit commit -m 'x'"))).toBeNull();
  });

  it("returns null for file redirect", async () => {
    expect(await safeBashCommand(bash("echo hi > /tmp/out"))).toBeNull();
  });

  it("returns null for semicolons", async () => {
    expect(await safeBashCommand(bash("ls ; echo pwned"))).toBeNull();
  });

  it("returns null for background", async () => {
    expect(await safeBashCommand(bash("ls &"))).toBeNull();
  });

  it("handles single-quoted args", async () => {
    expect(await safeBashCommand(bash("echo 'hello world'"))).toEqual(["echo", "hello world"]);
  });
});

describe("safeBashCommandOrPipeline", () => {
  function bash(command: string): ToolCall {
    return { tool: "Bash", args: { command }, context: { cwd: "/tmp", env: {}, projectRoot: null } };
  }

  it("returns args for simple command", async () => {
    expect(await safeBashCommandOrPipeline(bash("bun test src/"))).toEqual(["bun", "test", "src/"]);
  });

  it("returns first segment args when piped to safe filter", async () => {
    expect(await safeBashCommandOrPipeline(bash("bun test 2>&1 | tail -5"))).toEqual(["bun", "test"]);
  });

  it("returns first segment with multiple safe filters", async () => {
    expect(await safeBashCommandOrPipeline(bash("git log --oneline | grep fix | head -10"))).toEqual(
      ["git", "log", "--oneline"],
    );
  });

  it("returns null when piped to unsafe command", async () => {
    expect(await safeBashCommandOrPipeline(bash("bun test | xargs rm"))).toBeNull();
  });

  it("returns null for && chains", async () => {
    expect(await safeBashCommandOrPipeline(bash("bun test && rm -rf /"))).toBeNull();
  });
});

describe("findWriteRedirects", () => {
  it("finds > target", async () => {
    const ast = await parseShell("echo hi > /tmp/out");
    expect(findWriteRedirects(ast!)).toEqual([{ target: "/tmp/out", fd: null }]);
  });

  it("finds >> target", async () => {
    const ast = await parseShell("echo hi >> /tmp/out");
    expect(findWriteRedirects(ast!)).toEqual([{ target: "/tmp/out", fd: null }]);
  });

  it("ignores 2>/dev/null", async () => {
    const ast = await parseShell("ls 2>/dev/null");
    expect(findWriteRedirects(ast!)).toEqual([]);
  });

  it("returns 2>/other as a write", async () => {
    const ast = await parseShell("cmd 2>/tmp/err.log");
    expect(findWriteRedirects(ast!)).toEqual([{ target: "/tmp/err.log", fd: "2" }]);
  });

  it("ignores 2>&1", async () => {
    const ast = await parseShell("cmd 2>&1");
    expect(findWriteRedirects(ast!)).toEqual([]);
  });

  it("finds redirects inside && chains", async () => {
    const ast = await parseShell("mkdir -p /tmp/foo && cat > /tmp/foo/bar.md");
    expect(findWriteRedirects(ast!).length).toBeGreaterThan(0);
    expect(findWriteRedirects(ast!)[0].target).toBe("/tmp/foo/bar.md");
  });

  it("finds redirects across newlines", async () => {
    const ast = await parseShell("echo a > /dev/null\necho b > /etc/passwd");
    const writes = findWriteRedirects(ast!);
    expect(writes).toHaveLength(1); // /dev/null filtered out, /etc/passwd remains
    expect(writes[0].target).toBe("/etc/passwd");
  });
});

describe("findTeeTargets", () => {
  it("finds tee file arguments", async () => {
    const ast = await parseShell("echo hi | tee /tmp/out");
    expect(findTeeTargets(ast!)).toEqual(["/tmp/out"]);
  });

  it("skips tee flags", async () => {
    const ast = await parseShell("echo hi | tee -a /tmp/out");
    expect(findTeeTargets(ast!)).toEqual(["/tmp/out"]);
  });

  it("returns empty for no tee", async () => {
    const ast = await parseShell("echo hi | head");
    expect(findTeeTargets(ast!)).toEqual([]);
  });
});

describe("findGitSubcommands", () => {
  it("finds add and commit in compound command", async () => {
    const ast = await parseShell("git add . && git commit -m 'msg'");
    const subs = findGitSubcommands(ast!);
    expect(subs).toContain("add");
    expect(subs).toContain("commit");
  });

  it("finds subcommands across newlines", async () => {
    const ast = await parseShell("git add .\ngit commit -m 'msg'");
    const subs = findGitSubcommands(ast!);
    expect(subs).toContain("add");
    expect(subs).toContain("commit");
  });

  it("finds subcommand in simple command", async () => {
    const ast = await parseShell("git log --oneline");
    expect(findGitSubcommands(ast!)).toEqual(["log"]);
  });

  it("does not false-positive on quoted git mention", async () => {
    const ast = await parseShell("echo 'git add and git commit'");
    expect(findGitSubcommands(ast!)).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test policies/tests/parse-bash-ast.test.ts`
Expected: FAIL — functions not exported

**Step 3: Write the implementation**

Add to `policies/parse-bash-ast.ts`:

```ts
import type { ToolCall } from "../src";

// ── Safe write targets (shared constant) ───────────────────────────
const SAFE_WRITE_TARGETS = new Set(["/dev/null", "/dev/stderr", "/dev/stdout"]);

// ── High-level policy helpers ──────────────────────────────────────

/**
 * Parse a Bash ToolCall into a safe list of string args.
 * Returns null if:
 * - Not a Bash tool
 * - Parse fails
 * - Multiple statements (;, newline)
 * - Not a simple CallExpr (no pipes, &&, ||)
 * - Contains command substitution or parameter expansion
 * - Has file redirects (fd-to-fd and fd-to-devnull are OK)
 * - Background (&) or negated (!)
 */
export async function safeBashCommand(call: ToolCall): Promise<string[] | null> {
  if (call.tool !== "Bash") return null;
  if (typeof call.args.command !== "string") return null;

  const ast = await parseShell(call.args.command);
  if (!ast) return null;
  if (!isSimpleCommand(ast)) return null;
  if (ast.Stmts[0].Background || ast.Stmts[0].Negated) return null;
  if (hasUnsafeNodes(ast)) return null;

  return getArgs(ast.Stmts[0]);
}

/**
 * Parse a Bash ToolCall, allowing pipes to safe filter commands.
 * Returns the args of the first pipeline segment, or null if unsafe.
 *
 * Like safeBashCommand but also accepts:
 *   command | grep pattern | head -5
 * where all segments after the first are safe filters.
 */
export async function safeBashCommandOrPipeline(call: ToolCall): Promise<string[] | null> {
  if (call.tool !== "Bash") return null;
  if (typeof call.args.command !== "string") return null;

  const ast = await parseShell(call.args.command);
  if (!ast) return null;
  if (ast.Stmts.length !== 1) return null;
  if (ast.Stmts[0].Background || ast.Stmts[0].Negated) return null;
  if (hasUnsafeNodes(ast)) return null;

  const stmt = ast.Stmts[0];

  // Check redirects on the top-level statement
  if (stmt.Redirs) {
    for (const r of stmt.Redirs) {
      if (r.Op === Op.DplOut) continue;
      if (r.N !== null) {
        const target = wordToString(r.Word);
        if (target && SAFE_WRITE_TARGETS.has(target)) continue;
      }
      return null;
    }
  }

  // Simple command case
  if (stmt.Cmd?.Type === "CallExpr") {
    return getArgs(stmt);
  }

  // Pipeline case
  const cmds = getPipelineCommands(stmt);
  if (!cmds) return null;

  // Check redirects on each pipeline segment
  for (const seg of cmds) {
    if (seg.Redirs) {
      for (const r of seg.Redirs) {
        if (r.Op === Op.DplOut) continue;
        if (r.N !== null) {
          const target = wordToString(r.Word);
          if (target && SAFE_WRITE_TARGETS.has(target)) continue;
        }
        return null;
      }
    }
  }

  // All segments after the first must be safe filters
  for (let i = 1; i < cmds.length; i++) {
    const args = getArgs(cmds[i]);
    if (!args || !isSafeFilter(args)) return null;
  }

  return getArgs(cmds[0]);
}

// ── Safe filter list (same as old parse-bash.ts) ───────────────────

const SAFE_FILTERS = new Set([
  "grep", "egrep", "fgrep",
  "head", "tail",
  "wc",
  "cat",
  "tr",
  "cut",
]);

const CONDITIONAL_FILTERS: Record<string, (tokens: string[]) => boolean> = {
  sort: (tokens) => !tokens.some((t) => t === "-o" || t.startsWith("--output")),
  uniq: (tokens) => tokens.filter((t) => !t.startsWith("-")).length <= 1,
};

export function isSafeFilter(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const cmd = tokens[0];
  if (SAFE_FILTERS.has(cmd)) return true;
  const check = CONDITIONAL_FILTERS[cmd];
  if (check) return check(tokens);
  return false;
}

// ── Redirect helpers ───────────────────────────────────────────────

export interface WriteRedirectInfo {
  target: string | null;
  fd: string | null;
}

/**
 * Find all write redirects (> and >>) in the AST, excluding:
 * - fd-to-fd redirects (2>&1)
 * - redirects to safe targets (/dev/null, /dev/stderr, /dev/stdout)
 */
export function findWriteRedirects(file: ShellFile): WriteRedirectInfo[] {
  const results: WriteRedirectInfo[] = [];
  const allRedirs = getRedirects(file);
  for (const r of allRedirs) {
    // Skip fd-to-fd redirects
    if (r.op === Op.DplOut) continue;
    // Only care about write redirects
    if (r.op !== Op.RdrOut && r.op !== Op.AppOut) continue;
    // Skip safe targets
    if (r.target && SAFE_WRITE_TARGETS.has(r.target)) continue;
    results.push({ target: r.target, fd: r.fd });
  }
  return results;
}

/**
 * Find all file targets passed to `tee` commands in the AST.
 * Returns the file paths (skipping flags).
 */
export function findTeeTargets(file: ShellFile): string[] {
  const targets: string[] = [];
  function visit(stmt: Stmt) {
    const args = getArgs(stmt);
    if (args && args[0] === "tee") {
      for (const arg of args.slice(1)) {
        if (!arg.startsWith("-")) targets.push(arg);
      }
    }
    if (stmt.Cmd?.Type === "BinaryCmd") {
      const bin = stmt.Cmd as BinaryCmd;
      visit(bin.X);
      visit(bin.Y);
    }
  }
  for (const stmt of file.Stmts) visit(stmt);
  return targets;
}

/**
 * Find all git subcommands in the AST (e.g., "add", "commit", "log").
 * Walks all CallExpr nodes and returns the second arg if the first is "git".
 */
export function findGitSubcommands(file: ShellFile): string[] {
  const subs: string[] = [];
  function visit(stmt: Stmt) {
    const args = getArgs(stmt);
    if (args && args[0] === "git" && args[1]) {
      subs.push(args[1]);
    }
    if (stmt.Cmd?.Type === "BinaryCmd") {
      const bin = stmt.Cmd as BinaryCmd;
      visit(bin.X);
      visit(bin.Y);
    }
  }
  for (const stmt of file.Stmts) visit(stmt);
  return subs;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test policies/tests/parse-bash-ast.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add policies/parse-bash-ast.ts policies/tests/parse-bash-ast.test.ts
git commit -m "feat: add high-level policy helpers (safeBashCommand, findWriteRedirects, etc.)"
```

---

### Task 4: Port `deny-git-add-and-commit` to use AST

**Files:**
- Modify: `policies/deny-git-add-and-commit.ts`
- Test: `policies/tests/deny-git-add-and-commit.test.ts` (run existing tests, no changes needed)

This is the first policy migration. It replaces `shell-quote` parsing with `findGitSubcommands`.

**Step 1: Run existing tests to confirm they pass**

Run: `bun test policies/tests/deny-git-add-and-commit.test.ts`
Expected: PASS (baseline)

**Step 2: Rewrite the policy**

Replace the entire file:

```ts
// policies/deny-git-add-and-commit.ts
import { deny, next, type Policy } from "../src";
import { parseShell, findGitSubcommands } from "./parse-bash-ast";

/**
 * Deny compound git add-and-commit commands. Forces the add and commit
 * steps to be separate tool calls.
 */
const denyGitAddAndCommit: Policy = {
  name: "Deny git add-and-commit",
  description: "Blocks compound git add+commit commands, forcing separate steps",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();

    const ast = await parseShell(call.args.command);
    if (!ast) return next();

    const subcommands = findGitSubcommands(ast);
    const hasAdd = subcommands.includes("add");
    const hasCommit = subcommands.includes("commit");

    if (hasAdd && hasCommit) {
      return deny("Split git add and git commit into separate steps");
    }

    return next();
  },
};
export default denyGitAddAndCommit;
```

**Step 3: Run existing tests to verify they still pass**

Run: `bun test policies/tests/deny-git-add-and-commit.test.ts`
Expected: PASS — all existing tests pass unchanged

**Step 4: Commit**

```bash
git add policies/deny-git-add-and-commit.ts
git commit -m "refactor: port deny-git-add-and-commit to shfmt AST"
```

---

### Task 5: Port `deny-writes-outside-project` to use AST

**Files:**
- Modify: `policies/deny-writes-outside-project.ts`
- Test: `policies/tests/deny-writes-outside-project.test.ts` (run existing tests, no changes)

This replaces the most complex `shell-quote` usage — redirect detection and tee argument scanning.

**Step 1: Run existing tests to confirm they pass**

Run: `bun test policies/tests/deny-writes-outside-project.test.ts`
Expected: PASS (baseline)

**Step 2: Rewrite the policy**

```ts
// policies/deny-writes-outside-project.ts
import { homedir } from "os";
import { resolve } from "path";
import { allow, deny, next, type Policy } from "../src";
import { parseShell, findWriteRedirects, findTeeTargets } from "./parse-bash-ast";

const SAFE_WRITE_TARGETS = new Set(["/dev/null", "/dev/stderr", "/dev/stdout"]);

const denyWritesOutsideProject: Policy = {
  name: "Deny writes outside project",
  description: "Blocks file writes and Bash redirects targeting paths outside the project root",
  handler: async (call) => {
    if (!call.context.projectRoot) return next();

    const projectRoot = call.context.projectRoot;

    // Write and Edit: check file_path argument
    if (call.tool === "Write" || call.tool === "Edit") {
      const filePath = call.args.file_path;
      if (typeof filePath !== "string") return next();
      if (!isInsideProject(filePath, projectRoot)) {
        return deny(`Write blocked: ${filePath} is outside project root`);
      }
      return next();
    }

    // Bash: check for redirects and tee writing outside project
    if (call.tool === "Bash") {
      const command = call.args.command;
      if (typeof command !== "string") return next();

      const ast = await parseShell(command);
      if (!ast) return next();

      const cwd = call.context.cwd;
      let hasSafeRedirect = false;

      // Check write redirects (> and >>)
      const writeRedirects = findWriteRedirects(ast);
      for (const r of writeRedirects) {
        if (!r.target) continue;
        const resolved = resolvePath(r.target, cwd);
        if (resolved && !isInsideProject(resolved, projectRoot)) {
          return deny("Write blocked: redirect target is outside project root");
        }
      }

      // Check tee targets
      const teeTargets = findTeeTargets(ast);
      for (const target of teeTargets) {
        if (SAFE_WRITE_TARGETS.has(target)) {
          hasSafeRedirect = true;
          continue;
        }
        const resolved = resolvePath(target, cwd);
        if (resolved && !isInsideProject(resolved, projectRoot)) {
          return deny("Write blocked: redirect target is outside project root");
        }
      }

      // Check if there are any safe-only redirects (for the ALLOW verdict)
      const allRedirects = findWriteRedirects(ast);
      if (allRedirects.length === 0 && teeTargets.length > 0 && hasSafeRedirect) {
        return allow();
      }
      // Also check: bare > /dev/null etc. that findWriteRedirects already filtered
      // We need to re-check all redirects including safe ones
      const { getRedirects, Op } = await import("./parse-bash-ast");
      const rawRedirs = getRedirects(ast);
      const hasAnySafeRedirect = rawRedirs.some(
        (r) => (r.op === Op.RdrOut || r.op === Op.AppOut) && r.target && SAFE_WRITE_TARGETS.has(r.target),
      );
      if (hasAnySafeRedirect && writeRedirects.length === 0 && teeTargets.every((t) => SAFE_WRITE_TARGETS.has(t))) {
        return allow();
      }
    }

    return next();
  },
};
export default denyWritesOutsideProject;

function isInsideProject(filePath: string, projectRoot: string): boolean {
  return SAFE_WRITE_TARGETS.has(filePath) || filePath === projectRoot || filePath.startsWith(projectRoot + "/");
}

function resolvePath(p: string, cwd: string): string | null {
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (p === "~") return homedir();
  if (p.startsWith("/")) return p;
  if (!p.startsWith("-")) return resolve(cwd, p);
  return null;
}
```

Note: The `allow()` logic for safe redirects is a bit involved — review during implementation to make sure it's clean. The core idea: if ALL redirects target safe destinations, return `allow()`; if any target is outside project, return `deny()`; otherwise `next()`.

**Step 3: Run existing tests to verify they still pass**

Run: `bun test policies/tests/deny-writes-outside-project.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add policies/deny-writes-outside-project.ts
git commit -m "refactor: port deny-writes-outside-project to shfmt AST"
```

---

### Task 6: Port `redirect-plans-to-project` to use AST

**Files:**
- Modify: `policies/redirect-plans-to-project.ts`
- Test: `policies/tests/redirect-plans-to-project.test.ts` (run existing, no changes)

**Step 1: Run existing tests to confirm they pass**

Run: `bun test policies/tests/redirect-plans-to-project.test.ts`
Expected: PASS (baseline)

**Step 2: Rewrite the policy**

```ts
// policies/redirect-plans-to-project.ts
import { deny, next, type Policy } from "../src";
import { parseShell, findWriteRedirects, findTeeTargets, getRedirects, Op } from "./parse-bash-ast";

const GLOBAL_PLANS_DIR = "/.claude/plans";

const redirectPlansToProject: Policy = {
  name: "Redirect plans to project",
  description: "Blocks plan writes to ~/.claude/plans/ and suggests project docs/ instead",
  handler: async (call) => {
    if (!call.context.projectRoot) return next();

    const projectRoot = call.context.projectRoot;
    const docsDir = `${projectRoot}/docs`;

    if (call.tool === "Write" || call.tool === "Edit") {
      const filePath = call.args.file_path;
      if (typeof filePath !== "string") return next();
      if (isGlobalPlanPath(filePath)) {
        return deny(`Plan files should be saved in the project, not globally. Write to ${docsDir}/ instead of ${filePath}`);
      }
      return next();
    }

    if (call.tool === "Bash") {
      const command = call.args.command;
      if (typeof command !== "string") return next();

      const ast = await parseShell(command);
      if (!ast) return next();

      // Check write redirects
      const allRedirs = getRedirects(ast);
      for (const r of allRedirs) {
        if (r.op !== Op.RdrOut && r.op !== Op.AppOut) continue;
        if (r.target && isGlobalPlanPath(r.target)) {
          return deny(`Plan files should be saved in the project, not globally. Write to ${docsDir}/ instead of ${r.target}`);
        }
      }

      // Check tee targets
      const teeTargets = findTeeTargets(ast);
      for (const target of teeTargets) {
        if (isGlobalPlanPath(target)) {
          return deny(`Plan files should be saved in the project, not globally. Write to ${docsDir}/ instead of ${target}`);
        }
      }
    }

    return next();
  },
};
export default redirectPlansToProject;

function isGlobalPlanPath(filePath: string): boolean {
  return filePath.includes(GLOBAL_PLANS_DIR + "/") || filePath.endsWith(GLOBAL_PLANS_DIR);
}
```

**Step 3: Run existing tests to verify they still pass**

Run: `bun test policies/tests/redirect-plans-to-project.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add policies/redirect-plans-to-project.ts
git commit -m "refactor: port redirect-plans-to-project to shfmt AST"
```

---

### Task 7: Port all `safeBashTokensOrPipeline` consumers

**Files:**
- Modify: `policies/allow-bun-test.ts`
- Modify: `policies/allow-git-add.ts`
- Modify: `policies/allow-git-diff.ts`
- Modify: `policies/allow-git-log.ts`
- Modify: `policies/allow-git-status.ts`
- Modify: `policies/allow-git-rev-parse.ts`
- Modify: `policies/allow-gh-read-only.ts`
- Test: Run all existing test files for these policies

These all follow the same pattern: replace `safeBashTokensOrPipeline` (sync) with `safeBashCommandOrPipeline` (async).

**Step 1: Run all existing tests to confirm they pass**

Run: `bun test policies/tests/allow-bun-test.test.ts policies/tests/allow-git-add.test.ts policies/tests/allow-git-diff.test.ts policies/tests/allow-git-log.test.ts policies/tests/allow-git-status.test.ts policies/tests/allow-git-rev-parse.test.ts policies/tests/allow-gh-read-only.test.ts`
Expected: PASS

**Step 2: Port each policy**

The change is mechanical for all of them. Example for `allow-bun-test.ts`:

```ts
// Before:
import { safeBashTokensOrPipeline } from "./parse-bash";
// ...
const tokens = safeBashTokensOrPipeline(call);

// After:
import { safeBashCommandOrPipeline } from "./parse-bash-ast";
// ...
const tokens = await safeBashCommandOrPipeline(call);
```

Apply the same change to all 7 files. The handler is already `async`, so adding `await` is safe.

**Step 3: Run all tests to verify they still pass**

Run: `bun test policies/tests/allow-bun-test.test.ts policies/tests/allow-git-add.test.ts policies/tests/allow-git-diff.test.ts policies/tests/allow-git-log.test.ts policies/tests/allow-git-status.test.ts policies/tests/allow-git-rev-parse.test.ts policies/tests/allow-gh-read-only.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add policies/allow-bun-test.ts policies/allow-git-add.ts policies/allow-git-diff.ts policies/allow-git-log.ts policies/allow-git-status.ts policies/allow-git-rev-parse.ts policies/allow-gh-read-only.ts
git commit -m "refactor: port 7 allow-* policies to shfmt AST"
```

---

### Task 8: Port `allow-ls-in-project` and `allow-bash-find-in-project`

**Files:**
- Modify: `policies/allow-ls-in-project.ts`
- Modify: `policies/allow-bash-find-in-project.ts`
- Test: Run existing tests

These use `safeBashPipeline` + `isSafeFilter`. Replace with `safeBashCommandOrPipeline` for the simple case, or use `parseShell` + `getPipelineCommands` + `isSafeFilter` for the more complex `find` policy that also checks flags.

**Step 1: Run existing tests**

Run: `bun test policies/tests/allow-ls-in-project.test.ts policies/tests/allow-bash-find-in-project.test.ts`
Expected: PASS

**Step 2: Port allow-ls-in-project**

```ts
// policies/allow-ls-in-project.ts
import { allow, next, type Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs, isSafeFilter, isSimpleCommand } from "./parse-bash-ast";

const allowLsInProject: Policy = {
  name: "Allow ls in project",
  description: "Permits ls commands when all paths are within the project root",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();
    if (!call.context.projectRoot) return next();

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return next();

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds) return next();

    const tokens = getArgs(cmds[0]);
    if (!tokens || tokens[0] !== "ls") return next();

    // All pipe segments after the first must be safe filters
    for (let i = 1; i < cmds.length; i++) {
      const args = getArgs(cmds[i]);
      if (!args || !isSafeFilter(args)) return next();
    }

    const root = call.context.projectRoot;
    const paths = tokens.slice(1).filter((t) => !t.startsWith("-"));

    if (paths.length === 0) {
      if (call.context.cwd.startsWith(root + "/") || call.context.cwd === root) {
        return allow();
      }
      return next();
    }

    const allInProject = paths.every(
      (p) => p.startsWith(root + "/") || p === root || p.startsWith("./") || p === "." || !p.startsWith("/"),
    );

    return allInProject ? allow() : next();
  },
};
export default allowLsInProject;
```

**Step 3: Port allow-bash-find-in-project** (similar pattern but keep the SAFE_FLAGS whitelist)

```ts
// policies/allow-bash-find-in-project.ts
import { resolve } from "node:path";
import { allow, next, type Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs, isSafeFilter } from "./parse-bash-ast";

const allowBashFindInProject: Policy = {
  name: "Allow bash find in project",
  description: "Permits find commands when all paths are within the project root",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();
    if (!call.context.projectRoot) return next();

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return next();

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds) return next();

    const tokens = getArgs(cmds[0]);
    if (!tokens || tokens[0] !== "find") return next();

    for (let i = 1; i < cmds.length; i++) {
      const args = getArgs(cmds[i]);
      if (!args || !isSafeFilter(args)) return next();
    }

    // Whitelist of safe find predicates (same as before)
    const SAFE_FLAGS = new Set([
      "-print", "-print0", "-ls",
      "-name", "-iname", "-path", "-ipath", "-regex", "-iregex",
      "-type", "-size", "-empty", "-newer", "-perm", "-user", "-group",
      "-mtime", "-atime", "-ctime", "-mmin", "-amin", "-cmin",
      "-readable", "-writable", "-executable",
      "-maxdepth", "-mindepth",
      "-not", "-and", "-or", "!",
      "-follow", "-xdev", "-mount", "-daystart",
      "-true", "-false", "-prune",
    ]);

    for (const t of tokens.slice(1)) {
      if (t.startsWith("-") && !SAFE_FLAGS.has(t)) return next();
      if (t === "(" || t === ")") return next();
    }

    const root = call.context.projectRoot;
    const args = tokens.slice(1);
    const paths: string[] = [];
    for (const arg of args) {
      if (arg.startsWith("-") || arg === "!" || arg === "(") break;
      paths.push(arg);
    }

    if (paths.length === 0) {
      if (call.context.cwd.startsWith(root + "/") || call.context.cwd === root) {
        return allow();
      }
      return next();
    }

    const allInProject = paths.every((p) => {
      const resolved = resolve(call.context.cwd, p);
      return resolved.startsWith(root + "/") || resolved === root;
    });

    return allInProject ? allow() : next();
  },
};
export default allowBashFindInProject;
```

**Step 4: Run existing tests to verify they still pass**

Run: `bun test policies/tests/allow-ls-in-project.test.ts policies/tests/allow-bash-find-in-project.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add policies/allow-ls-in-project.ts policies/allow-bash-find-in-project.ts
git commit -m "refactor: port allow-ls-in-project and allow-bash-find-in-project to shfmt AST"
```

---

### Task 9: Port `deny-bash-grep` to use AST

**Files:**
- Modify: `policies/deny-bash-grep.ts`
- Test: `policies/tests/deny-bash-grep.test.ts` (run existing)

**Step 1: Run existing tests**

Run: `bun test policies/tests/deny-bash-grep.test.ts`
Expected: PASS

**Step 2: Rewrite the policy**

```ts
// policies/deny-bash-grep.ts
import { deny, next, type Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs } from "./parse-bash-ast";

const denyBashGrep: Policy = {
  name: "Deny bash grep",
  description: "Rejects grep/egrep/fgrep/rg in Bash — use the built-in Grep tool instead",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return next();

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds) return next();

    const args = getArgs(cmds[0]);
    if (!args) return next();

    const cmd = args[0];
    if (cmd === "grep" || cmd === "egrep" || cmd === "fgrep" || cmd === "rg") {
      return deny(
        "Do not use `grep` or `rg` in Bash. Use the built-in Grep tool instead — it supports regex, glob filters, and output modes (content, files_with_matches, count).",
      );
    }

    return next();
  },
};
export default denyBashGrep;
```

**Step 3: Run existing tests**

Run: `bun test policies/tests/deny-bash-grep.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add policies/deny-bash-grep.ts
git commit -m "refactor: port deny-bash-grep to shfmt AST"
```

---

### Task 10: Remove `shell-quote` dependency and old `parse-bash.ts`

**Files:**
- Delete: `policies/parse-bash.ts`
- Delete: `policies/tests/parse-bash.test.ts`
- Modify: `src/utils.ts` — remove re-exports of old functions
- Modify: `package.json` — remove `shell-quote` and `@types/shell-quote`

**Step 1: Update `src/utils.ts`**

Remove the old re-exports:

```ts
// src/utils.ts
import { execSync } from 'child_process'

export function findGitRoot(cwd: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

// New re-exports from AST module
export { safeBashCommand, safeBashCommandOrPipeline, isSafeFilter } from '../policies/parse-bash-ast'
```

**Step 2: Remove old files and dependency**

```bash
rm policies/parse-bash.ts policies/tests/parse-bash.test.ts
bun remove shell-quote @types/shell-quote
```

**Step 3: Run full test suite**

Run: `bun test`
Expected: PASS — all tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove shell-quote dependency and old parse-bash.ts"
```

---

### Task 11: Clean up tmp/ spike files and remove sh-syntax

**Files:**
- Delete: `tmp/test-shfmt.ts`
- Delete: `tmp/analyze-ast.ts`
- Modify: `package.json` — remove `sh-syntax` (we're using the Go binary directly, not the npm package)

**Step 1: Clean up**

```bash
rm -rf tmp/
bun remove sh-syntax
```

**Step 2: Run full test suite one final time**

Run: `bun test`
Expected: PASS

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: clean up spike files and remove sh-syntax"
```

---

## Summary of changes

| Before | After |
|---|---|
| `shell-quote` npm dependency | `shfmt` Go binary (already installed) |
| `parse-bash.ts` with regex metachar detection | `parse-bash-ast.ts` with proper AST types |
| `safeBashTokens()` (sync, fragile) | `safeBashCommand()` (async, AST-based) |
| `safeBashPipeline()` (sync, manual pipe splitting) | `getPipelineCommands()` (AST pipe tree flattening) |
| `safeBashTokensOrPipeline()` | `safeBashCommandOrPipeline()` |
| `stripFdRedirects()` regex hack | AST `Redirect` nodes with `Op` and `N` fields |
| Duplicate redirect detection in 2 policies | Shared `findWriteRedirects()` and `findTeeTargets()` |
| Metacharacter regex (`/[`$|;&(){}]/`) | `hasUnsafeNodes()` checking AST node types |
| `shell-quote` + manual newline splitting | shfmt handles all parsing natively |
