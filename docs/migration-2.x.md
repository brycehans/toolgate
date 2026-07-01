# Migrating from toolgate 1.x to 2.x

toolgate 2.0 is a cleanup release. It removes the legacy `Middleware` policy API
that 1.x kept alive for backwards compatibility, and it prunes a couple of
built-in policies. Nothing about *how the engine decides* changed — deny still
runs before allow, first activated verdict still wins. What changed is **how you
author a policy** and **which built-ins ship in the box**.

> **Automated path:** run `toolgate migrate` in a project to dry-run the codemod
> (report only), then `toolgate migrate --write` to apply it. It handles the
> whole §1 API migration — adds `action`, rewrites `allow()`/`deny()`/`next()`
> returns, and strips the dead helper imports. It refuses (and reports) any
> policy that mixes `allow()` and `deny()`, since that needs a human-chosen
> split (see below). It does **not** cover the §2 built-in changes.

There are two kinds of change to check for:

1. **API changes** — affect you if any of your policies (or tests) were still
   written in the pre-1.0 `Middleware` style, or import `allow` / `deny` /
   `next` / `Middleware` from the package.
2. **Built-in changes** — affect you if you relied on the built-in `tmux` policy,
   or referenced the old combined `gh issue/pr` policy by name.

If none of that applies — every policy already declares an `action` and returns
`string | boolean | void`, and you never touched tmux — **2.0 is a no-op.**
Bump the dependency and move on.

> **Most readers only need §2.** The action-based API has been the documented
> way to author policies since 1.0; `Middleware` was only ever a pre-1.0 compat
> shim. If you adopted toolgate at 1.0 or later, your policies are already
> action-based and §1 is a no-op — skip to the built-in changes.

---

## 1. API changes

### What was removed

| Removed in 2.0 | Replacement |
|---|---|
| Policies with no `action` field | `action: "deny" \| "allow"` is now **required** |
| `handler` returning a `VerdictResult` via `allow()` / `deny()` / `next()` | `handler` returns `string \| boolean \| void` |
| The `Middleware` type export | `PolicyHandler` is the only handler type |
| The `allow`, `deny`, `next` helper exports | Return plain values (see cheat sheet) |
| The legacy compat branch in `runPolicy` | Every policy is adapted through `adaptHandler` |

In 2.0 `Policy.action` is a **required** field and `Policy.handler` is typed as
`PolicyHandler` only. A policy object missing `action` is now a TypeScript error
(and at runtime would be treated as a deny).

### Migrating a legacy policy

The single-action model means one policy expresses **one** decision — it either
denies or allows, never both. A legacy handler that only ever returned
`allow()`/`next()` becomes an `action: "allow"` policy; one that only returned
`deny()`/`next()` becomes `action: "deny"`. Add the `action` field, rewrite the
returns per the cheat sheet below, and drop the `allow`/`deny`/`next` imports.

### Handlers that both allowed *and* denied — split them

If a single legacy handler returned **both** `allow()` and `deny()`, it can't
map to one 2.x policy. Split it into a `deny` policy and an `allow` policy.
Because the engine always runs deny policies before allow policies, the split is
behaviour-preserving.

```ts
import type { Policy } from "@brycehanscomb/toolgate";

const denyX: Policy = {
  name: "Deny X",
  description: "...",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (bad(call)) return "not allowed"; // string reason → deny with message
  },
};

const allowX: Policy = {
  name: "Allow X",
  description: "...",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (ok(call)) return true; // allow
  },
};
```

(This is exactly what happened to the built-in `gh issue/pr` policy — see §2.)

### Return-value cheat sheet

| Old (`Middleware`) | New (`action: "allow"`) | New (`action: "deny"`) |
|---|---|---|
| `return allow()` | `return true` | n/a — use an allow policy |
| `return deny("reason")` | n/a — use a deny policy | `return "reason"` |
| `return deny()` (no reason) | n/a | `return true` |
| `return next()` | `return` / `return undefined` | `return` / `return undefined` |

### Imports

`allow`, `deny`, `next`, and the `Middleware` type are **no longer exported**
from `@brycehanscomb/toolgate`. Remove those imports. Most policy files now
import only `type { Policy }` (plus any AST helpers from `parse-bash-ast`).

> **Gotcha:** never delete an import before you've replaced every usage. If a
> toolgate config has a reference error, evaluation itself fails — which blocks
> *all* subsequent tool calls, including the ones you'd use to fix it. Replace
> usages first, then drop the import, or do both in one edit.

Still exported for tests and advanced use:

```
ALLOW, DENY, NEXT, isVerdictResult          // from verdicts
adaptHandler                                 // wrap a handler → VerdictResult
definePolicy, runPolicy, runPolicyWithTrace  // engine
isWithinProject, loadAdditionalDirs          // project-dirs helpers
type Policy, PolicyHandler, ToolCall,
     CallContext, VerdictResult, TracedResult
```

### Tests

Test wrapping is unchanged — wrap the handler with `adaptHandler` and assert on
the returned `VerdictResult`:

```ts
import { adaptHandler, ALLOW, type ToolCall } from "@brycehanscomb/toolgate";

const run = adaptHandler(policy.action, policy.handler);
const result = await run(call);
expect(result.verdict).toBe(ALLOW);
```

In 1.x you may have written `adaptHandler(policy.action!, policy.handler as any)`
to satisfy the optional/union types. With `action` required and `handler`
narrowed to `PolicyHandler`, the `!` and `as any` are gone.

---

## 2. Built-in policy changes

These are behavioral breaks that can bite you **even if all your policies
already use the action API.**

### The `tmux` policy was removed

1.x shipped a built-in "Allow tmux read and send-keys" policy. It's gone in 2.0 —
tmux was niche for a general-purpose builtin, and `send-keys` in particular
smuggles an inner command past per-call evaluation.

**Impact:** tmux commands that used to be auto-allowed now **fall through to a
prompt.** Nothing becomes unsafe; you just get asked. If you want the old
behaviour back, add it as a project or local policy (`toolgate.config.ts` /
`toolgate.config.local.ts`).

### The combined `gh issue/pr` policy was split

The old policy both allowed `gh issue`/`gh pr` actions and denied
`gh issue/pr delete`. The single-action model can't express both, so it became:

- `deny-gh-issue-pr-delete` (`action: "deny"`) — blocks `gh issue/pr delete`
- `allow-gh-issue-pr` (`action: "allow"`) — permits the rest

Deny runs before allow, so the net decision for any `gh` command is identical to
1.x. **The only thing that changed is the names.** If you disabled or referenced
the old combined policy by name (via the `disable` export or `toolgate disable`),
update the reference to the new name(s).

---

## Quick checklist

**API:**

1. Add `action: "deny" | "allow"` to every remaining legacy policy.
2. Split any policy that returned both `allow()` and `deny()` into two policies.
3. Rewrite handler returns per the cheat sheet.
4. Remove imports of `allow` / `deny` / `next` / `Middleware`.

**Built-ins:**

5. If you relied on the built-in tmux policy, re-add it as a project/local policy.
6. If you disabled the old combined `gh issue/pr` policy by name, point the
   disable at `"Deny gh issue/pr delete"` and/or `"Allow gh issue/pr actions"`
   (the `disable` export matches on a policy's `name` field exactly).

**Verify:**

7. Run your test suite.
8. Run `toolgate list` to confirm every policy loads, and `toolgate disable --json`
   to confirm any disable-by-name still resolves.
</content>
</invoke>
