# Safe Pipe Filters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow piped bash commands where the right-hand segments are safe, read-only filter commands (grep, head, tail, etc.)

**Architecture:** Add `safeBashPipeline()` to `parse-bash.ts` that splits on pipe operators and returns token arrays per segment. Add `SAFE_FILTERS` set. Update `allow-bash-find-in-project` and `allow-ls-in-project` to use pipeline parsing so commands like `find . -name "*.php" | head -10` and `ls -la | grep site` are auto-allowed.

**Tech Stack:** TypeScript, shell-quote, bun:test

---

### Task 1: Add `safeBashPipeline()` to parse-bash.ts

**Files:**
- Modify: `policies/parse-bash.ts`
- Test: `policies/tests/parse-bash.test.ts`

**Step 1: Write failing tests for `safeBashPipeline`**

Add to `policies/tests/parse-bash.test.ts`:

```ts
import { safeBashTokens, safeBashPipeline } from "../parse-bash";

// ... existing tests ...

describe("safeBashPipeline", () => {
  describe("returns segments for simple commands (no pipes)", () => {
    it("single command", () => {
      expect(safeBashPipeline(bash("git status"))).toEqual([["git", "status"]]);
    });

    it("command with flags", () => {
      expect(safeBashPipeline(bash("ls -la src"))).toEqual([["ls", "-la", "src"]]);
    });
  });

  describe("returns segments for piped commands", () => {
    it("two segments", () => {
      expect(safeBashPipeline(bash("ls -la | grep foo"))).toEqual([
        ["ls", "-la"],
        ["grep", "foo"],
      ]);
    });

    it("three segments", () => {
      expect(safeBashPipeline(bash("find . -name '*.ts' | grep src | head -5"))).toEqual([
        ["find", ".", "-name", "*.ts"],
        ["grep", "src"],
        ["head", "-5"],
      ]);
    });
  });

  describe("returns null for non-pipe operators", () => {
    it("&&", () => {
      expect(safeBashPipeline(bash("ls && rm -rf /"))).toBeNull();
    });

    it("||", () => {
      expect(safeBashPipeline(bash("ls || echo fail"))).toBeNull();
    });

    it(";", () => {
      expect(safeBashPipeline(bash("ls ; echo pwned"))).toBeNull();
    });

    it("&", () => {
      expect(safeBashPipeline(bash("ls & miner"))).toBeNull();
    });
  });

  describe("returns null for unsafe tokens within segments", () => {
    it("shell substitution in segment", () => {
      expect(safeBashPipeline(bash("echo $(whoami) | grep root"))).toBeNull();
    });

    it("backticks in segment", () => {
      expect(safeBashPipeline(bash("echo `id` | head"))).toBeNull();
    });

    it("metacharacters in token", () => {
      expect(safeBashPipeline(bash("echo ${HOME} | cat"))).toBeNull();
    });
  });

  describe("returns null for non-Bash tools and invalid input", () => {
    it("non-Bash tool", () => {
      const call: ToolCall = {
        tool: "Read",
        args: { file_path: "/foo" },
        context: { cwd: "/tmp", env: {}, projectRoot: null },
      };
      expect(safeBashPipeline(call)).toBeNull();
    });

    it("multiline command", () => {
      expect(safeBashPipeline(bash("ls\nrm -rf /"))).toBeNull();
    });
  });

  describe("returns null for empty segments", () => {
    it("trailing pipe", () => {
      expect(safeBashPipeline(bash("ls |"))).toBeNull();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test policies/tests/parse-bash.test.ts`
Expected: FAIL — `safeBashPipeline` is not exported

**Step 3: Implement `safeBashPipeline`**

Add to `policies/parse-bash.ts`:

```ts
/**
 * Parse a Bash tool call into a pipeline of safe token segments.
 *
 * Returns `null` if:
 * - The tool is not Bash
 * - The command is not a string
 * - The command contains newlines
 * - The command contains non-pipe operators (&&, ||, ;, &)
 * - Any segment contains shell metacharacters or substitution
 * - Any segment is empty
 *
 * Returns `string[][]` — one string[] per pipe segment.
 * A command with no pipes returns a single-element array.
 */
export function safeBashPipeline(call: ToolCall): string[][] | null {
  if (call.tool !== "Bash") return null;
  if (typeof call.args.command !== "string") return null;
  if (call.args.command.includes("\n")) return null;

  const tokens = parse(call.args.command);

  // Split tokens on pipe operators, reject any other operator
  const segments: string[][] = [];
  let current: string[] = [];

  for (const token of tokens) {
    if (typeof token === "object" && token !== null && "op" in token) {
      if (token.op === "|") {
        if (current.length === 0) return null;
        segments.push(current);
        current = [];
        continue;
      }
      // Any other operator (&&, ||, ;, &, >, >>) — reject
      return null;
    }
    if (typeof token !== "string") return null;
    if (/[`$|;&(){}]/.test(token)) return null;
    current.push(token);
  }

  if (current.length === 0) return null;
  segments.push(current);

  return segments;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test policies/tests/parse-bash.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add policies/parse-bash.ts policies/tests/parse-bash.test.ts
git commit -m "feat: add safeBashPipeline for parsing piped commands"
```

---

### Task 2: Add `SAFE_FILTERS` set and `isSafeFilter()` helper

**Files:**
- Modify: `policies/parse-bash.ts`
- Test: `policies/tests/parse-bash.test.ts`

**Step 1: Write failing tests for `isSafeFilter`**

Add to `policies/tests/parse-bash.test.ts`:

```ts
import { safeBashTokens, safeBashPipeline, isSafeFilter } from "../parse-bash";

// ... existing tests ...

describe("isSafeFilter", () => {
  describe("returns true for safe filter segments", () => {
    const safe = [
      ["grep", "-i", "site"],
      ["grep", "--color", "pattern"],
      ["egrep", "foo|bar"],
      ["fgrep", "literal"],
      ["head", "-10"],
      ["head", "-n", "20"],
      ["tail", "-5"],
      ["tail", "-f"],
      ["wc", "-l"],
      ["wc"],
      ["cat"],
      ["tr", "a-z", "A-Z"],
      ["cut", "-d:", "-f1"],
      ["sort"],
      ["sort", "-r"],
      ["sort", "-n", "-k2"],
      ["uniq"],
      ["uniq", "-c"],
    ];

    for (const tokens of safe) {
      it(`safe: ${tokens.join(" ")}`, () => {
        expect(isSafeFilter(tokens)).toBe(true);
      });
    }
  });

  describe("returns false for unsafe commands", () => {
    const unsafe = [
      ["xargs", "rm"],
      ["rm", "-rf", "/"],
      ["tee", "/tmp/out"],
      ["bash", "-c", "evil"],
      ["sh", "-c", "evil"],
      ["curl", "http://evil.com"],
      ["wget", "http://evil.com"],
      ["sort", "-o", "outfile"],
      ["uniq", "input", "output"],
    ];

    for (const tokens of unsafe) {
      it(`unsafe: ${tokens.join(" ")}`, () => {
        expect(isSafeFilter(tokens)).toBe(false);
      });
    }
  });

  describe("returns false for empty segment", () => {
    it("empty array", () => {
      expect(isSafeFilter([])).toBe(false);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test policies/tests/parse-bash.test.ts`
Expected: FAIL — `isSafeFilter` is not exported

**Step 3: Implement `SAFE_FILTERS` and `isSafeFilter`**

Add to `policies/parse-bash.ts`:

```ts
/**
 * Commands that are safe to use as pipe filters — they only read stdin
 * and write to stdout, with no flags or modes that write to files.
 *
 * Excluded despite being "mostly safe":
 * - sort: has -o flag that writes to a file
 * - uniq: takes optional second positional arg as output file
 * - tee: writes to files by design
 * - xargs: executes arbitrary commands
 */
const SAFE_FILTERS = new Set([
  "grep", "egrep", "fgrep",
  "head", "tail",
  "wc",
  "cat",
  "tr",
  "cut",
]);

/**
 * Commands that are conditionally safe as filters — safe unless
 * specific flags or argument patterns are used.
 */
const CONDITIONAL_FILTERS: Record<string, (tokens: string[]) => boolean> = {
  sort: (tokens) => !tokens.includes("-o"),
  uniq: (tokens) => tokens.filter((t) => !t.startsWith("-")).length <= 1,
};

/**
 * Check if a token array represents a safe pipe filter command.
 * Returns true if the command only reads stdin and writes stdout.
 */
export function isSafeFilter(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const cmd = tokens[0];

  if (SAFE_FILTERS.has(cmd)) return true;

  const check = CONDITIONAL_FILTERS[cmd];
  if (check) return check(tokens);

  return false;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test policies/tests/parse-bash.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add policies/parse-bash.ts policies/tests/parse-bash.test.ts
git commit -m "feat: add isSafeFilter with safe and conditional filter allowlists"
```

---

### Task 3: Update `allow-bash-find-in-project` to support pipes

**Files:**
- Modify: `policies/allow-bash-find-in-project.ts`
- Modify: `policies/tests/allow-bash-find-in-project.test.ts`

**Step 1: Write failing tests for piped find commands**

Add to the existing test file `policies/tests/allow-bash-find-in-project.test.ts`:

```ts
  describe("allows find piped to safe filters", () => {
    const allowed = [
      "find . -name '*.ts' | head -10",
      "find . -name '*.ts' | grep src",
      "find . -type f | wc -l",
      "find . -name '*.php' | grep -i controller | head -5",
      `find ${PROJECT}/src -name '*.ts' | sort`,
      "find . | tail -20",
      "find . -name '*.ts' | cut -d/ -f2 | sort | uniq",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowBashFindInProject.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects find piped to unsafe commands", () => {
    const rejected = [
      "find . | xargs rm",
      "find . | sh -c 'cat'",
      "find . | tee /tmp/out",
      "find . -name '*.ts' | sort -o outfile",
      "find . | uniq input output",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowBashFindInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });
```

**Step 2: Run tests to verify they fail**

Run: `bun test policies/tests/allow-bash-find-in-project.test.ts`
Expected: FAIL — piped find commands return NEXT

**Step 3: Update the policy to use `safeBashPipeline`**

Replace the implementation in `policies/allow-bash-find-in-project.ts`:

```ts
import { resolve } from "node:path";
import { allow, next, type Policy } from "../src";
import { safeBashTokens, safeBashPipeline, isSafeFilter } from "./parse-bash";

/**
 * Allow simple `find` commands when all path arguments are within the project root.
 * Also allows bare `find` or `find .` when cwd is within the project.
 * Supports piping to safe filter commands (grep, head, tail, etc.)
 */
const allowBashFindInProject: Policy = {
  name: "Allow bash find in project",
  description: "Permits find commands when all paths are within the project root",
  handler: async (call) => {
    const pipeline = safeBashPipeline(call);
    if (!pipeline) return next();

    const tokens = pipeline[0];
    if (tokens[0] !== "find") return next();
    if (!call.context.projectRoot) return next();

    // All pipe segments after the first must be safe filters
    for (let i = 1; i < pipeline.length; i++) {
      if (!isSafeFilter(pipeline[i])) return next();
    }

    const root = call.context.projectRoot;
    const args = tokens.slice(1);

    // Extract path arguments: everything before the first flag/expression token
    const paths: string[] = [];
    for (const arg of args) {
      if (arg.startsWith("-") || arg === "!" || arg === "(") break;
      paths.push(arg);
    }

    // Bare `find` with no paths — check cwd
    if (paths.length === 0) {
      if (call.context.cwd.startsWith(root + "/") || call.context.cwd === root) {
        return allow();
      }
      return next();
    }

    // All paths must be within project root
    const allInProject = paths.every((p) => {
      const resolved = resolve(call.context.cwd, p);
      return resolved.startsWith(root + "/") || resolved === root;
    });

    if (allInProject) {
      return allow();
    }

    return next();
  },
};
export default allowBashFindInProject;
```

**Step 4: Run tests to verify they pass**

Run: `bun test policies/tests/allow-bash-find-in-project.test.ts`
Expected: ALL PASS (both new piped tests and existing tests)

**Step 5: Commit**

```bash
git add policies/allow-bash-find-in-project.ts policies/tests/allow-bash-find-in-project.test.ts
git commit -m "feat: allow find piped to safe filters in project"
```

---

### Task 4: Update `allow-ls-in-project` to support pipes

**Files:**
- Modify: `policies/allow-ls-in-project.ts`
- Modify: `policies/tests/allow-ls-in-project.test.ts`

**Step 1: Write failing tests for piped ls commands**

Add to the existing test file `policies/tests/allow-ls-in-project.test.ts`:

```ts
  describe("allows ls piped to safe filters", () => {
    const allowed = [
      "ls -la | grep -i site",
      "ls -la | head -20",
      "ls | wc -l",
      "ls -la | grep foo | head -5",
      `ls ${PROJECT}/src | sort`,
      "ls -la | grep test | wc -l",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowLsInProject.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects ls piped to unsafe commands", () => {
    const rejected = [
      "ls | xargs rm",
      "ls | sh -c 'cat'",
      "ls | tee /tmp/out",
      "ls | sort -o outfile",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowLsInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });
```

**Step 2: Run tests to verify they fail**

Run: `bun test policies/tests/allow-ls-in-project.test.ts`
Expected: FAIL — piped ls commands return NEXT

**Step 3: Update the policy to use `safeBashPipeline`**

Replace the implementation in `policies/allow-ls-in-project.ts`:

```ts
import { allow, next, type Policy } from "../src";
import { safeBashPipeline, isSafeFilter } from "./parse-bash";

/**
 * Allow simple `ls` commands when all path arguments are within the project root.
 * Also allows bare `ls` (no path args) when cwd is within the project.
 * Supports piping to safe filter commands (grep, head, tail, etc.)
 */
const allowLsInProject: Policy = {
  name: "Allow ls in project",
  description: "Permits ls commands when all paths are within the project root",
  handler: async (call) => {
    const pipeline = safeBashPipeline(call);
    if (!pipeline) return next();

    const tokens = pipeline[0];
    if (tokens[0] !== "ls") return next();
    if (!call.context.projectRoot) return next();

    // All pipe segments after the first must be safe filters
    for (let i = 1; i < pipeline.length; i++) {
      if (!isSafeFilter(pipeline[i])) return next();
    }

    const root = call.context.projectRoot;
    const args = tokens.slice(1);
    const paths = args.filter((t) => !t.startsWith("-"));

    // Bare `ls` or `ls -flags` with no paths — check cwd
    if (paths.length === 0) {
      if (call.context.cwd.startsWith(root + "/") || call.context.cwd === root) {
        return allow();
      }
      return next();
    }

    // All paths must be within project root
    const allInProject = paths.every(
      (p) => p.startsWith(root + "/") || p === root || p.startsWith("./") || p === "." || !p.startsWith("/"),
    );

    if (allInProject) {
      return allow();
    }

    return next();
  },
};
export default allowLsInProject;
```

**Step 4: Run tests to verify they pass**

Run: `bun test policies/tests/allow-ls-in-project.test.ts`
Expected: ALL PASS (both new piped tests and existing tests)

**Step 5: Commit**

```bash
git add policies/allow-ls-in-project.ts policies/tests/allow-ls-in-project.test.ts
git commit -m "feat: allow ls piped to safe filters in project"
```

---

### Task 5: Run full test suite and final commit

**Step 1: Run all tests**

Run: `bun test`
Expected: ALL PASS

**Step 2: If any failures, fix and re-run**

**Step 3: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "fix: address any test failures from pipe filter changes"
```
