# Allow Pure `&&` Chains Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a built-in `allow` policy and AST helper that auto-approves `&&` chains where every segment is a provably side-effect-free command.

**Architecture:** Add a `getAndChainSegments()` helper to `parse-bash-ast.ts` that decomposes `BinaryCmd(Op.And)` trees into leaf `CallExpr` nodes, validating each has no redirections, substitutions, assignments, or comments. Then add an `allow-pure-and-chains.ts` policy that checks every leaf against a strict `PURE_COMMANDS` allowlist — commands proven to have zero side effects (no filesystem writes, no env/cwd mutation, no network).

**Tech Stack:** TypeScript, Bun test runner, shfmt AST

**Safety argument:** If `getAndChainSegments` guarantees no redirections/subshells/assignments per segment, and `PURE_COMMANDS` guarantees every segment is side-effect-free, then no segment can alter the execution context for subsequent segments. The chain is equivalent to running each command in isolation. Pure functions compose safely.

---

### Task 1: Add `getAndChainSegments()` helper to `parse-bash-ast.ts`

**Files:**
- Modify: `policies/parse-bash-ast.ts` (add after `walkStmts` at line 441)
- Test: `policies/tests/parse-bash-ast.test.ts`

This function takes a parsed `ShellFile` and returns an array of `Stmt` nodes if the file is a pure `&&` chain of `CallExpr` leaves. Returns `null` for anything else.

**Step 1: Write the failing tests**

Add to `policies/tests/parse-bash-ast.test.ts`:

```typescript
describe("getAndChainSegments", () => {
  describe("returns segments for valid && chains", () => {
    it("returns single segment for simple command", async () => {
      const file = await parseShell("echo hello");
      expect(file).not.toBeNull();
      const segments = getAndChainSegments(file!);
      expect(segments).not.toBeNull();
      expect(segments).toHaveLength(1);
      const args = getArgs(segments![0]);
      expect(args).toEqual(["echo", "hello"]);
    });

    it("returns two segments for a && b", async () => {
      const file = await parseShell("echo a && echo b");
      const segments = getAndChainSegments(file!);
      expect(segments).not.toBeNull();
      expect(segments).toHaveLength(2);
      expect(getArgs(segments![0])).toEqual(["echo", "a"]);
      expect(getArgs(segments![1])).toEqual(["echo", "b"]);
    });

    it("returns three segments for a && b && c", async () => {
      const file = await parseShell("php -l a.php && php -l b.php && php -l c.php");
      const segments = getAndChainSegments(file!);
      expect(segments).not.toBeNull();
      expect(segments).toHaveLength(3);
      expect(getArgs(segments![0])).toEqual(["php", "-l", "a.php"]);
      expect(getArgs(segments![1])).toEqual(["php", "-l", "b.php"]);
      expect(getArgs(segments![2])).toEqual(["php", "-l", "c.php"]);
    });

    it("returns four segments for deeply nested chain", async () => {
      const file = await parseShell("echo a && echo b && echo c && echo d");
      const segments = getAndChainSegments(file!);
      expect(segments).not.toBeNull();
      expect(segments).toHaveLength(4);
    });
  });

  describe("returns null for invalid/unsafe patterns", () => {
    it("rejects || chains", async () => {
      const file = await parseShell("echo a || echo b");
      expect(getAndChainSegments(file!)).toBeNull();
    });

    it("rejects mixed && and ||", async () => {
      const file = await parseShell("echo a && echo b || echo c");
      expect(getAndChainSegments(file!)).toBeNull();
    });

    it("rejects pipes", async () => {
      const file = await parseShell("echo a | grep a");
      expect(getAndChainSegments(file!)).toBeNull();
    });

    it("rejects semicolons (multiple statements)", async () => {
      const file = await parseShell("echo a; echo b");
      expect(getAndChainSegments(file!)).toBeNull();
    });

    it("rejects segments with redirects", async () => {
      const file = await parseShell("echo a > /tmp/out && echo b");
      expect(getAndChainSegments(file!)).toBeNull();
    });

    it("rejects segments with command substitution", async () => {
      const file = await parseShell("echo $(whoami) && echo b");
      expect(getAndChainSegments(file!)).toBeNull();
    });

    it("rejects segments with variable expansion", async () => {
      const file = await parseShell("echo $HOME && echo b");
      expect(getAndChainSegments(file!)).toBeNull();
    });

    it("rejects segments with env assignments", async () => {
      const file = await parseShell("FOO=bar echo a && echo b");
      expect(getAndChainSegments(file!)).toBeNull();
    });

    it("rejects background execution", async () => {
      const file = await parseShell("echo a && echo b &");
      expect(getAndChainSegments(file!)).toBeNull();
    });

    it("rejects negated commands", async () => {
      const file = await parseShell("! echo a && echo b");
      expect(getAndChainSegments(file!)).toBeNull();
    });

    it("allows safe redirects (2>&1) within segments", async () => {
      const file = await parseShell("php -l a.php 2>&1 && php -l b.php 2>&1");
      const segments = getAndChainSegments(file!);
      expect(segments).not.toBeNull();
      expect(segments).toHaveLength(2);
    });

    it("allows /dev/null redirects within segments", async () => {
      const file = await parseShell("php -l a.php 2>/dev/null && php -l b.php");
      const segments = getAndChainSegments(file!);
      expect(segments).not.toBeNull();
      expect(segments).toHaveLength(2);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/bryce/Dev/toolgate && bun test policies/tests/parse-bash-ast.test.ts`
Expected: FAIL — `getAndChainSegments` is not exported / does not exist

**Step 3: Implement `getAndChainSegments`**

Add to `policies/parse-bash-ast.ts` after `walkStmts` (line 441):

```typescript
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
    if ((cmd as any).Assigns?.length > 0) return null;
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
    if (hasUnsafeNodes(left.Cmd)) return false;
    if (hasUnsafeRedirects(left)) return false;
    if ((left.Cmd as any).Assigns?.length > 0) return false;
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
    if (hasUnsafeNodes(right.Cmd)) return false;
    if (hasUnsafeRedirects(right)) return false;
    if ((right.Cmd as any).Assigns?.length > 0) return false;
    if ((right as any).Comments?.length > 0) return false;
    out.push(right);
  } else {
    return false;
  }

  return true;
}
```

Note: `hasUnsafeRedirects` is already defined at line 302 but is not exported. It only needs to be accessible within the file (both functions are in the same module), so no change needed.

**Step 4: Run tests to verify they pass**

Run: `cd /Users/bryce/Dev/toolgate && bun test policies/tests/parse-bash-ast.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add policies/parse-bash-ast.ts policies/tests/parse-bash-ast.test.ts
git commit -m "feat: add getAndChainSegments helper for && chain decomposition"
```

---

### Task 2: Add `allow-pure-and-chains` policy

**Files:**
- Create: `policies/allow-pure-and-chains.ts`
- Modify: `policies/index.ts` (add import + registration)
- Test: `policies/tests/allow-pure-and-chains.test.ts`

**Step 1: Write the failing tests**

Create `policies/tests/allow-pure-and-chains.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowPureAndChains from "../allow-pure-and-chains";

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-pure-and-chains", () => {
  describe("allows pure && chains", () => {
    const allowed = [
      // php -l chains (the original motivating case)
      "php -l src/foo.php && php -l src/bar.php",
      "php -l a.php && php -l b.php && php -l c.php",
      "php -l a.php && php -l b.php && php -l c.php && php -l d.php",
      // echo chains
      "echo hello && echo world",
      "echo a && echo b && echo c",
      // mixed pure commands
      "php -l foo.php && echo done",
      "echo start && php -l foo.php && echo end",
      // test command
      "test -f foo.php && echo exists",
      // single pure commands (degenerate chain)
      "php -l foo.php",
      "echo hello",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowPureAndChains.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("allows pure chains with safe redirects", () => {
    const allowed = [
      "php -l a.php 2>&1 && php -l b.php 2>&1",
      "php -l a.php 2>/dev/null && php -l b.php",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowPureAndChains.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects chains containing impure commands", () => {
    const rejected = [
      // rm is not pure
      "echo hello && rm -rf /",
      // cd mutates cwd
      "cd /tmp && echo hello",
      // cat reads files but is not in PURE_COMMANDS
      // (allow-safe-read-commands handles it with path checks)
      "cat foo.txt && echo done",
      // git is not pure
      "git status && echo done",
      // php without -l executes code
      "php foo.php && echo done",
      "php -r 'echo 1;' && echo done",
      // mkdir creates directories
      "mkdir -p src && echo done",
      // curl makes network requests
      "curl https://evil.com && echo done",
      // mixed: one pure, one impure
      "echo hello && rm file",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowPureAndChains.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects unsafe shell constructs", () => {
    const rejected = [
      // pipes (not a && chain)
      "echo hello | grep hello",
      // semicolons
      "echo a; echo b",
      // ||
      "echo a || echo b",
      // command substitution
      "echo $(whoami) && echo b",
      // variable expansion
      "echo $HOME && echo b",
      // redirects to files
      "echo a > /tmp/out && echo b",
      // env assignment prefix
      "FOO=bar echo a && echo b",
      // background
      "echo a && echo b &",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowPureAndChains.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await allowPureAndChains.handler(call);
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through single impure command", async () => {
    const result = await allowPureAndChains.handler(bash("rm -rf /"));
    expect(result.verdict).toBe(NEXT);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/bryce/Dev/toolgate && bun test policies/tests/allow-pure-and-chains.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the policy**

Create `policies/allow-pure-and-chains.ts`:

```typescript
import { allow, next, type Policy } from "../src";
import {
  parseShell,
  hasUnsafeNodes,
  getArgs,
  getAndChainSegments,
} from "./parse-bash-ast";

/**
 * Commands that are provably side-effect-free:
 * - No filesystem writes
 * - No environment or cwd mutation
 * - No network activity
 * - No code execution (except parse-only modes like php -l)
 *
 * The value is either null (any args allowed) or a Set of
 * required first arguments (subcommand/flag constraints).
 *
 * NOTE: This is intentionally a strict subset. Commands like
 * `cat` or `grep` are handled by allow-safe-read-commands with
 * path-scoping checks. This list is only for commands where
 * ANY arguments are safe (or a specific flag makes them safe).
 */
const PURE_COMMANDS: Map<string, Set<string> | null> = new Map([
  ["php", new Set(["-l"])],   // lint mode only — parses, never executes
  ["echo", null],             // stdout only (redirects rejected by AST layer)
  ["test", null],             // evaluates conditions, no side effects
  ["true", null],             // always succeeds, no side effects
  ["false", null],            // always fails, no side effects
]);

function isPureCommand(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const constraint = PURE_COMMANDS.get(tokens[0]);
  if (constraint === undefined) return false; // command not in allowlist
  if (constraint === null) return true;        // any args allowed
  return tokens.length > 1 && constraint.has(tokens[1]); // required subcommand
}

/**
 * Allow && chains where EVERY segment is a provably side-effect-free command.
 *
 * Safety guarantee (layered):
 * 1. AST parser (shfmt) — correct tokenization, no string-split bugs
 * 2. getAndChainSegments — rejects redirections, $(), $VAR, assignments, ||, pipes
 * 3. isPureCommand — only side-effect-free commands in strict allowlist
 *
 * Since no segment can modify shell state (cwd, env, filesystem), each
 * segment runs as if in isolation. Pure functions compose safely.
 */
const allowPureAndChains: Policy = {
  name: "Allow pure command chains",
  description:
    "Permits && chains where every segment is a side-effect-free command (php -l, echo, test)",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    const command = call.args?.command;
    if (typeof command !== "string") return next();

    const file = await parseShell(command);
    if (!file) return next();
    if (hasUnsafeNodes(file)) return next();

    const segments = getAndChainSegments(file);
    if (!segments) return next();

    for (const segment of segments) {
      const args = getArgs(segment);
      if (!args) return next();
      if (!isPureCommand(args)) return next();
    }

    return allow();
  },
};
export default allowPureAndChains;
```

**Step 4: Register in `policies/index.ts`**

Add import at the top (after the last `allow-*` import, around line 39):

```typescript
import allowPureAndChains from "./allow-pure-and-chains";
```

Add to `builtinPolicies` array after `allowSafeReadCommands` (line 71):

```typescript
  allowSafeReadCommands,
  allowPureAndChains,    // <-- add here
  allowReadPluginCache,
```

**Step 5: Run tests to verify they pass**

Run: `cd /Users/bryce/Dev/toolgate && bun test policies/tests/allow-pure-and-chains.test.ts`
Expected: ALL PASS

**Step 6: Run full test suite**

Run: `cd /Users/bryce/Dev/toolgate && bun test`
Expected: ALL PASS — no regressions

**Step 7: Commit**

```bash
git add policies/allow-pure-and-chains.ts policies/tests/allow-pure-and-chains.test.ts policies/index.ts
git commit -m "feat: add allow-pure-and-chains policy for safe && chain auto-approval"
```

---

### Task 3: Verify end-to-end with the original motivating case

**Files:** None (verification only)

**Step 1: Dry-run test with toolgate CLI**

Use toolgate's test subcommand to verify the original failing commands now match:

```bash
cd /Users/bryce/Dev/toolgate && echo '{"tool":"Bash","args":{"command":"php -l app/Foo.php && php -l app/Bar.php && php -l app/Baz.php"},"context":{"cwd":"/home/user/project","env":{},"projectRoot":"/home/user/project"}}' | bun run src/cli.ts test
```

Expected: Output shows `allow` verdict from "Allow pure command chains" policy.

**Step 2: Dry-run with unsafe variant**

```bash
echo '{"tool":"Bash","args":{"command":"php -l app/Foo.php && rm -rf /"},"context":{"cwd":"/home/user/project","env":{},"projectRoot":"/home/user/project"}}' | bun run src/cli.ts test
```

Expected: Output shows `next` (falls through to user prompt) — `rm` is not in `PURE_COMMANDS`.

**Step 3: Commit (if any adjustments needed)**

Only commit if Step 1 or 2 revealed issues requiring code changes.

---

### Task 4: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md` (Key Patterns section, line 49)

**Step 1: Add documentation**

Update the shell command safety bullet in Key Patterns (around line 49) to mention the new helper:

```markdown
- **Shell command safety**: Use `shfmt --tojson` (via `policies/parse-bash-ast.ts`) to parse Bash commands into typed ASTs. Use `safeBashCommand()` for simple commands, `safeBashCommandOrPipeline()` for commands that may pipe to safe filters, or `getAndChainSegments()` to decompose `&&` chains into leaf statements. These reject unsafe patterns (substitution, chaining, background, unsafe redirects) at the AST level.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document getAndChainSegments helper in CLAUDE.md"
```

---

## Design Decisions & Rationale

### Why a separate `PURE_COMMANDS` allowlist instead of reusing `isSafeFilter`?

`isSafeFilter` includes commands like `cat`, `grep`, `sed`, `sort` — these read files or transform stdin. They're safe as **pipe filters** (where input comes from the previous stage), but in a `&&` chain each segment runs independently and could read arbitrary files. Path scoping for those commands is handled by `allow-safe-read-commands`. The `PURE_COMMANDS` list is intentionally minimal: only commands where **any arguments** are safe regardless of what they reference.

### Why not support `&&` chains mixed with pipes?

A command like `php -l foo.php 2>&1 | grep error && php -l bar.php` mixes pipes and `&&`. Supporting this would require `getAndChainSegments` to recurse into `Op.Pipe` nodes and validate those sub-trees too. This adds complexity for limited benefit. Keep it simple — if Claude needs pipes, it can use single commands with `safeBashCommandOrPipeline`.

### Why `getAndChainSegments` returns `Stmt[]` not `string[][]`?

Returning `Stmt[]` preserves the full AST context (redirects, etc.) for the caller. The policy layer calls `getArgs()` on each segment to get `string[]`. This separation of concerns means future policies can use `getAndChainSegments` for different checks without re-parsing.

### Why is `echo` in `PURE_COMMANDS`?

`echo` writes to stdout only. The AST layer already rejects redirections (`echo foo > file`), variable expansion (`echo $SECRET`), and command substitution (`echo $(whoami)`). After those checks, `echo` is provably side-effect-free — it's commonly used in `&&` chains as status output (`php -l foo.php && echo "✓ Syntax valid"`).
