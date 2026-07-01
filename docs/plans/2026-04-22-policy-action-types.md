# Policy Action Types Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split policies into `action: "deny"` and `action: "allow"` types with simplified handler return values (truthy = activate, void = pass), and enforce deny-before-allow evaluation order in the engine.

**Architecture:** Add an `action` field to `Policy`. Handlers return `string | boolean | void` instead of `VerdictResult`. The engine partitions policies by action, runs all deny policies first (any truthy = deny), then allow policies (any truthy = allow), else falls through to ask. Existing `allow()`/`deny()`/`next()` helpers and `VerdictResult` remain for internal engine use only — policy authors no longer touch them.

**Tech Stack:** TypeScript, Bun test runner, shfmt AST parsing (unchanged)

**Related:** [GitHub Issue #7](https://github.com/brycehans/toolgate/issues/7), [Issue #6 (session-scoped policies)](https://github.com/brycehans/toolgate/issues/6)

---

## Summary of Changes

The new `Policy` type:
```ts
interface Policy {
  name: string;
  description: string;
  action: "deny" | "allow";
  handler: (call: ToolCall) => Promise<string | boolean | void>;
}
```

- **Allow policy** handler returns `true` → allow, `void` → pass
- **Deny policy** handler returns `true` → deny (no reason), `"reason"` → deny with reason, `void` → pass
- Engine runs all deny-action policies first, then allow-action policies
- `Middleware`, `VerdictResult`, `allow()`, `deny()`, `next()` become internal — no longer needed by policy authors
- `definePolicy()` still works for project configs but accepts the new shape
- Backward compat: the engine can detect old-style handlers (returning VerdictResult objects) and warn/adapt during migration, but this is optional — a clean cutover is fine since all policies are in-tree

---

### Task 1: Update `Policy` type and add handler adapter

**Files:**
- Modify: `src/types.ts`
- Create: `src/adapter.ts`
- Test: `src/tests/adapter.test.ts`

**Step 1: Write failing tests for the adapter**

Create `src/tests/adapter.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { adaptHandler } from "../adapter";
import { ALLOW, DENY, NEXT } from "../verdicts";

describe("adaptHandler", () => {
  describe("allow action", () => {
    it("converts true to ALLOW", async () => {
      const handler = adaptHandler("allow", async () => true);
      const result = await handler({} as any);
      expect(result.verdict).toBe(ALLOW);
    });

    it("converts void/undefined to NEXT", async () => {
      const handler = adaptHandler("allow", async () => {});
      const result = await handler({} as any);
      expect(result.verdict).toBe(NEXT);
    });

    it("converts false to NEXT", async () => {
      const handler = adaptHandler("allow", async () => false);
      const result = await handler({} as any);
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("deny action", () => {
    it("converts true to DENY without reason", async () => {
      const handler = adaptHandler("deny", async () => true);
      const result = await handler({} as any);
      expect(result.verdict).toBe(DENY);
      expect("reason" in result).toBe(false);
    });

    it("converts string to DENY with reason", async () => {
      const handler = adaptHandler("deny", async () => "not allowed here");
      const result = await handler({} as any);
      expect(result.verdict).toBe(DENY);
      expect((result as any).reason).toBe("not allowed here");
    });

    it("converts void/undefined to NEXT", async () => {
      const handler = adaptHandler("deny", async () => {});
      const result = await handler({} as any);
      expect(result.verdict).toBe(NEXT);
    });

    it("converts false to NEXT", async () => {
      const handler = adaptHandler("deny", async () => false);
      const result = await handler({} as any);
      expect(result.verdict).toBe(NEXT);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/tests/adapter.test.ts`
Expected: FAIL — module not found

**Step 3: Update `src/types.ts`**

Replace the `Policy` interface and `Middleware` type:

```ts
import type { ALLOW, DENY, NEXT } from "./verdicts";

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
  context: CallContext;
}

export interface CallContext {
  cwd: string;
  env: Record<string, string>;
  projectRoot: string;
  additionalDirs: string[];
}

export type VerdictResult =
  | { verdict: typeof ALLOW }
  | { verdict: typeof DENY; reason?: string }
  | { verdict: typeof NEXT };

/** @internal Used by the engine to run adapted handlers */
export type Middleware = (call: ToolCall) => Promise<VerdictResult>;

/** New simplified handler signature for policy authors */
export type PolicyHandler = (call: ToolCall) => Promise<string | boolean | void>;

export interface Policy {
  name: string;
  description: string;
  action: "deny" | "allow";
  handler: PolicyHandler;
}
```

**Step 4: Create `src/adapter.ts`**

```ts
import type { ToolCall, VerdictResult, PolicyHandler } from "./types";
import type { Middleware } from "./types";
import { allow, deny, next } from "./verdicts";

export function adaptHandler(
  action: "deny" | "allow",
  handler: PolicyHandler,
): Middleware {
  return async (call: ToolCall): Promise<VerdictResult> => {
    const result = await handler(call);

    // Falsy or void → pass through
    if (result === undefined || result === null || result === false) {
      return next();
    }

    if (action === "allow") {
      return allow();
    }

    // action === "deny"
    if (typeof result === "string") {
      return deny(result);
    }
    return deny();
  };
}
```

**Step 5: Update `src/index.ts` exports**

Add the new types to the public API:

```ts
export { ALLOW, DENY, NEXT, allow, deny, next, isVerdictResult } from './verdicts'
export type { ToolCall, CallContext, VerdictResult, Middleware, Policy, PolicyHandler } from './types'
export { definePolicy, runPolicy, runPolicyWithTrace } from './policy'
export type { TracedResult } from './policy'
export { isWithinProject, loadAdditionalDirs } from './project-dirs'
export { adaptHandler } from './adapter'
```

**Step 6: Run tests to verify they pass**

Run: `bun test src/tests/adapter.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/types.ts src/adapter.ts src/tests/adapter.test.ts src/index.ts
git commit -m "feat: add policy action types and handler adapter"
```

---

### Task 2: Update `runPolicy` to partition by action

**Files:**
- Modify: `src/policy.ts`
- Create: `src/tests/policy-action-order.test.ts`

**Step 1: Write failing tests for action-based ordering**

Create `src/tests/policy-action-order.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { runPolicy, runPolicyWithTrace } from "../policy";
import { ALLOW, DENY, NEXT } from "../verdicts";
import type { Policy, ToolCall } from "../types";

const call: ToolCall = {
  tool: "Bash",
  args: { command: "echo hi" },
  context: { cwd: "/tmp", env: {}, projectRoot: "/tmp", additionalDirs: [] },
};

describe("runPolicy action ordering", () => {
  it("runs deny policies before allow policies regardless of array order", async () => {
    const log: string[] = [];

    const allowFirst: Policy = {
      name: "allow-first",
      description: "",
      action: "allow",
      handler: async () => { log.push("allow"); return true; },
    };
    const denySecond: Policy = {
      name: "deny-second",
      description: "",
      action: "deny",
      handler: async () => { log.push("deny"); }, // pass through
    };

    // allow is listed first, but deny should run first
    const result = await runPolicy([allowFirst, denySecond], call);
    expect(log).toEqual(["deny", "allow"]);
    expect(result.verdict).toBe(ALLOW);
  });

  it("deny policy short-circuits before allow policies run", async () => {
    const log: string[] = [];

    const allowPolicy: Policy = {
      name: "allow-it",
      description: "",
      action: "allow",
      handler: async () => { log.push("allow"); return true; },
    };
    const denyPolicy: Policy = {
      name: "deny-it",
      description: "",
      action: "deny",
      handler: async () => { log.push("deny"); return "blocked"; },
    };

    const result = await runPolicy([allowPolicy, denyPolicy], call);
    expect(log).toEqual(["deny"]);
    expect(result.verdict).toBe(DENY);
  });

  it("preserves relative order within same action type", async () => {
    const log: string[] = [];

    const deny1: Policy = {
      name: "deny-1",
      description: "",
      action: "deny",
      handler: async () => { log.push("deny-1"); },
    };
    const deny2: Policy = {
      name: "deny-2",
      description: "",
      action: "deny",
      handler: async () => { log.push("deny-2"); },
    };
    const allow1: Policy = {
      name: "allow-1",
      description: "",
      action: "allow",
      handler: async () => { log.push("allow-1"); return true; },
    };

    await runPolicy([allow1, deny2, deny1], call);
    // deny policies run first in original relative order, then allow
    expect(log).toEqual(["deny-2", "deny-1", "allow-1"]);
  });

  it("returns NEXT when no policy activates", async () => {
    const passThrough: Policy = {
      name: "noop",
      description: "",
      action: "allow",
      handler: async () => {},
    };

    const result = await runPolicy([passThrough], call);
    expect(result.verdict).toBe(NEXT);
  });

  it("trace returns correct policy name on deny", async () => {
    const denyPolicy: Policy = {
      name: "the-blocker",
      description: "blocks stuff",
      action: "deny",
      handler: async () => "nope",
    };

    const { result, name } = await runPolicyWithTrace([denyPolicy], call);
    expect(result.verdict).toBe(DENY);
    expect(name).toBe("the-blocker");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/tests/policy-action-order.test.ts`
Expected: FAIL — policies don't have `action` field yet in test, and `runPolicy` doesn't partition

**Step 3: Update `src/policy.ts`**

Replace the implementation to partition by action and adapt handlers:

```ts
import type { Policy, ToolCall, VerdictResult } from './types'
import { isVerdictResult, next, NEXT } from './verdicts'
import { adaptHandler } from './adapter'

export function definePolicy(policies: Policy[]): Policy[] {
  return policies
}

export interface TracedResult {
  result: VerdictResult
  /** Index of the policy in the original input array, or -1 if all passed */
  index: number
  /** Name of the policy, if available */
  name: string | null
  /** Description of the policy, if available */
  description: string | null
}

export async function runPolicy(policies: Policy[], call: ToolCall): Promise<VerdictResult> {
  const { result } = await runPolicyWithTrace(policies, call)
  return result
}

export async function runPolicyWithTrace(policies: Policy[], call: ToolCall): Promise<TracedResult> {
  // Partition into deny-first, allow-second, preserving relative order within each group
  const denyPolicies: { policy: Policy; originalIndex: number }[] = []
  const allowPolicies: { policy: Policy; originalIndex: number }[] = []

  for (let i = 0; i < policies.length; i++) {
    const p = policies[i]
    if (p.action === 'deny') {
      denyPolicies.push({ policy: p, originalIndex: i })
    } else {
      allowPolicies.push({ policy: p, originalIndex: i })
    }
  }

  const ordered = [...denyPolicies, ...allowPolicies]

  for (const { policy, originalIndex } of ordered) {
    const adapted = adaptHandler(policy.action, policy.handler)
    const result = await adapted(call)

    if (!isVerdictResult(result)) {
      throw new Error(
        `toolgate: policy[${originalIndex}] "${policy.name}" returned invalid verdict: ${JSON.stringify(result)}\n` +
        `  Every policy handler must return allow(), deny(), or next().`
      )
    }

    if (result.verdict !== NEXT) {
      return { result, index: originalIndex, name: policy.name, description: policy.description }
    }
  }

  return { result: next(), index: -1, name: null, description: null }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/tests/policy-action-order.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/policy.ts src/tests/policy-action-order.test.ts
git commit -m "feat: partition policies by action — deny runs before allow"
```

---

### Task 3: Migrate all deny policies

Every deny policy needs: add `action: "deny"`, change handler to return `string | void` instead of `deny(reason)` / `next()`.

**Files to modify (7 files):**
- `policies/deny-git-add-and-commit.ts`
- `policies/deny-writes-outside-project.ts`
- `policies/deny-git-dash-c.ts`
- `policies/deny-cd-chained.ts`
- `policies/deny-git-chained.ts`
- `policies/deny-gh-heredoc.ts`
- `policies/deny-ssh-compound.ts`
- `policies/deny-mixed-pure-chains.ts`
- `policies/redirect-plans-to-project.ts` (this is a deny-action policy)
- `policies/redirect-python-json-to-fx.ts` (this is a deny-action policy)

**Migration pattern for each deny policy:**

Before:
```ts
import { deny, next, type Policy } from "../src";

const myPolicy: Policy = {
  name: "Deny something",
  description: "...",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (isDangerous(call)) return deny("reason here");
    return next();
  },
};
```

After:
```ts
import type { Policy } from "../src";

const myPolicy: Policy = {
  name: "Deny something",
  description: "...",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (isDangerous(call)) return "reason here";
  },
};
```

Key changes:
- Remove `deny` and `next` imports (keep only `type Policy` and any AST helpers)
- Add `action: "deny"`
- Replace `return deny("reason")` → `return "reason"`
- Replace `return deny()` → `return true`
- Replace `return next()` → `return` (or just let function fall through)

**Step 1: Migrate all deny policies**

Apply the pattern above to each of the 10 files listed.

**Step 2: Run deny policy tests**

Run: `bun test policies/tests/deny-*.test.ts policies/tests/redirect-*.test.ts`
Expected: PASS (tests check `result.verdict` which comes from the adapted handler — still works since the adapter converts return values to VerdictResult objects)

Wait — the tests call `policy.handler(call)` directly and check `.verdict`. With the new handler signature, `handler()` returns `string | boolean | void`, not a VerdictResult. The tests will break.

**Decision:** Update the tests in the same task. The test migration pattern:

Before:
```ts
const result = await policy.handler(bash(cmd));
expect(result.verdict).toBe(DENY);
```

After:
```ts
const result = await policy.handler(bash(cmd));
expect(result).toBe("reason string");  // or: expect(result).toBe(true) for no-reason deny
```

And for pass-through:
```ts
const result = await policy.handler(bash(cmd));
expect(result).toBeUndefined();  // was NEXT
```

Actually, to keep tests consistent and still test the full pipeline, add a small helper:

```ts
import { adaptHandler } from "@brycehanscomb/toolgate";

// Wrap handler to get VerdictResult for assertions
function adapted(policy: Policy) {
  return adaptHandler(policy.action, policy.handler);
}

// Usage:
const result = await adapted(policy)(bash(cmd));
expect(result.verdict).toBe(DENY);
```

This avoids rewriting every assertion and tests the full adapt→verdict flow.

**Step 3: Migrate all deny policy test files (10 files)**

Test files to update:
- `policies/tests/deny-git-add-and-commit.test.ts`
- `policies/tests/deny-writes-outside-project.test.ts`
- `policies/tests/deny-cd-chained.test.ts`
- `policies/tests/deny-git-chained.test.ts`
- `policies/tests/deny-gh-heredoc.test.ts`
- `policies/tests/deny-mixed-pure-chains.test.ts`
- `policies/tests/redirect-plans-to-project.test.ts`
- `policies/tests/redirect-python-json-to-fx.test.ts`

Add `adaptHandler` import and wrap `policy.handler` calls through it.

**Step 4: Run all deny/redirect tests**

Run: `bun test policies/tests/deny-*.test.ts policies/tests/redirect-*.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add policies/deny-*.ts policies/redirect-*.ts policies/tests/deny-*.test.ts policies/tests/redirect-*.test.ts
git commit -m "refactor: migrate deny policies to action-based handlers"
```

---

### Task 4: Migrate all allow policies

Same pattern but for allow policies — 50+ files.

**Migration pattern for each allow policy:**

Before:
```ts
import { allow, next, type Policy } from "../src";

const myPolicy: Policy = {
  name: "Allow something",
  description: "...",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (isSafe(call)) return allow();
    return next();
  },
};
```

After:
```ts
import type { Policy } from "../src";

const myPolicy: Policy = {
  name: "Allow something",
  description: "...",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (isSafe(call)) return true;
  },
};
```

Key changes:
- Remove `allow` and `next` imports
- Add `action: "allow"`
- Replace `return allow()` → `return true`
- Replace `return next()` → `return` (or fall through)

**Step 1: Migrate all allow policy files**

All `policies/allow-*.ts` files (there are ~50).

**Step 2: Migrate all allow policy test files**

Same pattern as Task 3 — add `adaptHandler` wrapper or test raw return values.

Test files: all `policies/tests/allow-*.test.ts`

**Step 3: Run all policy tests**

Run: `bun test policies/tests/`
Expected: PASS

**Step 4: Commit**

```bash
git add policies/allow-*.ts policies/tests/allow-*.test.ts
git commit -m "refactor: migrate allow policies to action-based handlers"
```

---

### Task 5: Migrate project config and update `definePolicy`

**Files:**
- Modify: `toolgate.config.ts` (root project config)
- Modify: `src/testing.ts` (testPolicy helper)

**Step 1: Update `toolgate.config.ts`**

Migrate the two inline policies to the new shape:

```ts
import { definePolicy } from "./src/index";

const CLAUDE_DIR = `${homedir()}/.claude`;
const FILE_TOOLS = new Set(["Read", "Write", "Edit"]);
const PATH_TOOLS = new Set(["Glob", "Grep"]);

function getPath(tool: string, args: Record<string, any>): string | null {
  if (FILE_TOOLS.has(tool)) return typeof args.file_path === "string" ? args.file_path : null;
  if (PATH_TOOLS.has(tool)) return typeof args.path === "string" ? args.path : null;
  return null;
}

export default definePolicy([
  {
    name: "Allow CRUD in ~/.claude",
    description: "Permits Read/Write/Edit/Glob/Grep on paths within ~/.claude",
    action: "allow",
    handler: async (call) => {
      if (!FILE_TOOLS.has(call.tool) && !PATH_TOOLS.has(call.tool)) return;
      const path = getPath(call.tool, call.args);
      if (!path) return;
      if (path === CLAUDE_DIR || path.startsWith(CLAUDE_DIR + "/")) return true;
    },
  },
  {
    name: "Allow claude-code-guide agent",
    description: "Permits the claude-code-guide read-only research agent",
    action: "allow",
    handler: async (call) => {
      if (call.tool !== "Agent") return;
      if (call.args.subagent_type !== "claude-code-guide") return;
      return true;
    },
  },
]);
```

**Step 2: Update `src/testing.ts`**

The `testPolicy` function calls `runPolicy` which now handles adaptation internally, so it should still work. Verify by running existing tests that use `testPolicy`.

**Step 3: Run full test suite**

Run: `bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add toolgate.config.ts src/testing.ts
git commit -m "refactor: migrate project config to action-based policies"
```

---

### Task 6: Clean up exports and update CLAUDE.md

**Files:**
- Modify: `src/index.ts` — consider whether `allow()`, `deny()`, `next()` should still be public exports
- Modify: `CLAUDE.md` — update policy authoring examples

**Step 1: Update exports**

Keep `allow`, `deny`, `next`, `ALLOW`, `DENY`, `NEXT` exported — they're still used by `testing.ts` assertions and the engine. But policy authors no longer need them. Update `CLAUDE.md` to reflect the new authoring pattern.

**Step 2: Update `CLAUDE.md` policy examples**

Replace the "Writing a Policy" section with the new pattern:

```ts
import type { Policy } from "../src";

const myPolicy: Policy = {
  name: "My policy",
  description: "Describes what this policy does",
  action: "allow",  // or "deny"
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (isSafe(call)) return true;
    // implicit return = pass through to next policy
  },
};
export default myPolicy;
```

Update the architecture section to explain:
- `action: "deny"` policies run first — return a string (deny with reason) or `true` (deny) to block
- `action: "allow"` policies run second — return `true` to permit
- Returning `undefined`/`void` passes through to the next policy
- The engine guarantees deny-before-allow ordering regardless of array position

**Step 3: Commit**

```bash
git add src/index.ts CLAUDE.md
git commit -m "docs: update CLAUDE.md for action-based policy authoring"
```

---

### Task 7: Run full test suite and verify

**Step 1: Run all tests**

Run: `bun test`
Expected: ALL PASS

**Step 2: Manual smoke test**

Run: `echo '{"tool_name":"Bash","tool_input":{"command":"git status"},"cwd":"/tmp"}' | bun run src/cli.ts run`
Expected: JSON output with `permissionDecision: "allow"` (from allow-git-status policy)

Run: `echo '{"tool_name":"Bash","tool_input":{"command":"git add . && git commit -m test"},"cwd":"/tmp"}' | bun run src/cli.ts run`
Expected: JSON output with `permissionDecision: "deny"` (from deny-git-add-and-commit)

**Step 3: Run `toolgate list` to verify policies load**

Run: `bun run src/cli.ts list`
Expected: All policies listed with names and descriptions

**Step 4: Bump version**

Bump minor version in `package.json` (this is a new feature / breaking change to policy authoring API).

**Step 5: Final commit**

```bash
git add package.json
git commit -m "chore: bump version for action-based policy types"
```
