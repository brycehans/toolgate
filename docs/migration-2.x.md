# Migrating from toolgate 1.x to 2.x

The 2.0 release **removes the legacy `Middleware` compat shim** that 1.x kept
for backwards compatibility. The action-based API introduced in 1.0 is now the
only way to author a policy.

If your policies already declare an `action` and return `string | boolean | void`
(the 1.x style), **you have nothing to do** — 2.0 is a no-op for you. This guide
is for policies still written in the pre-1.0 `Middleware` style.

## What was removed

| Removed in 2.0 | Replacement |
|---|---|
| Policies without an `action` field | `action: "deny" \| "allow"` is now **required** |
| `handler` returning a `VerdictResult` (`allow()`/`deny()`/`next()`) | `handler` returns `string \| boolean \| void` |
| The `Middleware` type (`export`ed from the package) | `PolicyHandler` is the only handler type |
| Package exports `allow`, `deny`, `next` | Return plain values instead (see below) |
| The legacy branch in `runPolicy` | Every policy is now adapted through `adaptHandler` |

`Policy.handler` is now typed as `PolicyHandler` only. `Policy.action` is now a
required field, so a policy object without it is a **type error** (and, at
runtime, would be treated as a deny).

## Migrating a legacy policy

**Before (Middleware, still worked in 1.x):**

```ts
import { allow, deny, next, type Policy } from "@brycehanscomb/toolgate";

const myPolicy: Policy = {
  name: "Allow X",
  description: "...",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (bad(call)) return deny("not allowed");
    if (ok(call)) return allow();
    return next();
  },
};
```

**After (2.x):** a policy has a single `action`. If your old handler returned
**both** `allow()` and `deny()` (like the example above), split it into two
policies — one `deny`, one `allow`. Deny always runs first, so the split is
behaviour-preserving.

```ts
import type { Policy } from "@brycehanscomb/toolgate";

const denyX: Policy = {
  name: "Deny X",
  description: "...",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (bad(call)) return "not allowed"; // string reason → deny
  },
};

const allowX: Policy = {
  name: "Allow X",
  description: "...",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (ok(call)) return true; // truthy → allow
  },
};
```

### Return-value cheat sheet

| Old (`Middleware`) | New (`action: "allow"`) | New (`action: "deny"`) |
|---|---|---|
| `return allow()` | `return true` | n/a (use an allow policy) |
| `return deny("reason")` | n/a (use a deny policy) | `return "reason"` |
| `return deny()` | n/a | `return true` |
| `return next()` | `return` | `return` |

## Imports

`allow`, `deny`, and `next` are **no longer exported** from
`@brycehanscomb/toolgate`, and neither is the `Middleware` type. Remove those
imports — policy files typically now import only `type { Policy }` (plus any AST
helpers from `parse-bash-ast`).

Still exported for tests and advanced use: `ALLOW`, `DENY`, `NEXT`,
`isVerdictResult`, `adaptHandler`, `runPolicy`, `runPolicyWithTrace`,
`definePolicy`, and the `VerdictResult` / `Policy` / `PolicyHandler` types.

## Tests

Test wrapping is unchanged from 1.x — wrap the handler with `adaptHandler`:

```ts
import { adaptHandler, ALLOW, type ToolCall } from "@brycehanscomb/toolgate";

const run = adaptHandler(policy.action, policy.handler);
const result = await run(call);
expect(result.verdict).toBe(ALLOW);
```

(In 1.x you may have written `adaptHandler(policy.action!, policy.handler as any)`
to satisfy the optional/union types. With `action` required and `handler`
narrowed to `PolicyHandler`, the `!` and `as any` are no longer needed.)

## Quick checklist

1. Add `action: "deny" | "allow"` to every remaining legacy policy.
2. Split any policy that returned both `allow()` and `deny()` into two policies.
3. Rewrite handler returns per the cheat sheet above.
4. Remove imports of `allow` / `deny` / `next` / `Middleware`.
5. Run your suite, then `toolgate list` to confirm everything loads.
