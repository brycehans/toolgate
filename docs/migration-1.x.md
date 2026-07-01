# Migrating from toolgate 0.x to 1.x

The 1.0 release replaced the `Middleware`-style policy authoring API with a simpler declarative shape, and the engine now partitions policies so deny rules always run before allow rules regardless of array order. The 1.x series is **backwards-compatible** — legacy policies still work — but the compat shim will be removed in 2.0, so migrate now.

## The change at a glance

**Old API (0.x)** — handlers returned `VerdictResult` via the `allow()`/`deny()`/`next()` helpers:

```ts
import { allow, deny, next, type Policy } from "@brycehanscomb/toolgate";

const myPolicy: Policy = {
  name: "Allow X",
  description: "...",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (isOk(call)) return allow();
    return next();
  },
};
```

**New API (1.x)** — declare `action`, return truthy/void:

```ts
import type { Policy } from "@brycehanscomb/toolgate";

const myPolicy: Policy = {
  name: "Allow X",
  description: "...",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (isOk(call)) return true;
  },
};
```

## What changed mechanically

| Old (0.x) | New (1.x) |
|---|---|
| handler returns `VerdictResult` via `allow()` / `deny()` / `next()` | handler returns `string \| boolean \| void` |
| no `action` field | `action: "deny" \| "allow"` declares intent |
| array order determines run order | engine partitions: **all denies run before any allows** |
| `import { allow, deny, next, type Policy }` | `import type { Policy }` |

## Migration patterns

### Allow policy

| Old | New |
|---|---|
| `return allow()` | `return true` |
| `return next()` | `return` (or just fall through) |

### Deny policy

| Old | New |
|---|---|
| `return deny("reason here")` | `return "reason here"` |
| `return deny()` | `return true` |
| `return next()` | `return` |

### Tests

Old assertions called the handler directly and inspected `.verdict`:

```ts
const result = await policy.handler(call);
expect(result.verdict).toBe(ALLOW);
```

Wrap the new-style handler through `adaptHandler` so your tests keep working:

```ts
import { adaptHandler, ALLOW, type ToolCall } from "@brycehanscomb/toolgate";

const run = adaptHandler(policy.action!, policy.handler as any);
const result = await run(call);
expect(result.verdict).toBe(ALLOW);
```

`adaptHandler` is the same shim the engine uses internally, so the test path matches production exactly.

## Order semantics changed (important)

**Before (0.x):** policies ran in array order, first non-`next()` won.

**After (1.x):** the engine partitions on `action`. Every `action: "deny"` policy runs first in its original relative order; every `action: "allow"` policy runs after; first activating verdict in that ordering wins.

**Implication:** you can no longer place an `allow` early in the array to pre-empt a later `deny` on the same tool. A deny on a tool will **always** fire before any allow gets a chance. This is intentional — it prevents broad allows from silently weakening safety-critical denies. If you were relying on array order to allow-before-deny, that's exactly the bug class this refactor closes.

## Legacy compat (1.x only)

Policies **without** an `action` field still work in 1.x — they're treated as legacy `Middleware`, called with the old `(call) => VerdictResult` signature, and run in the allow partition (after all `action: "deny"` policies). The compat path is in `src/policy.ts` if you want to read it.

This compat layer will be removed in 2.0. Migrate now to avoid surprise.

## Renamed built-in policies

If your `toolgate.config.ts` has a `disable: [...]` list referring to built-in policies by name, two were renamed and broadened in 1.5:

| Old name | New name | What changed |
|---|---|---|
| `Allow ls in project` | `Allow ls` | Now allows any path with no dot-prefixed segments (so `ls /tmp`, `ls ~/Downloads`), still blocks `ls .git`, `ls ~/.ssh`, etc. |
| `Allow bash find in project` | `Allow bash find` | Now allows any path under `$HOME` (dangerous find flags still rejected at AST level) |

If you relied on the project-root restriction, drop in a custom replacement policy.

## Other things to double-check

- `definePolicy()` in `toolgate.config.ts` — call signature unchanged, but the policies it accepts must use the new shape (or be legacy-shaped without `action`).
- `allow()`, `deny()`, `next()`, `ALLOW`, `DENY`, `NEXT` are still exported. They're used by the engine, by `adaptHandler`, and by tests. You only need to drop the imports from policy files where you no longer call them.
- `Policy.handler` is now typed as `PolicyHandler | Middleware` — TypeScript will infer correctly in both styles, but if you cast explicitly you may need to update.

## Quick checklist

1. Add `action: "deny" | "allow"` to every policy.
2. Rewrite handler returns: `allow()` → `true`, `deny("x")` → `"x"`, `deny()` → `true`, `next()` → bare `return`.
3. Drop unused imports of `allow` / `deny` / `next`.
4. Wrap test calls with `adaptHandler` instead of asserting on raw return values.
5. Audit any `disable` lists for renamed policy names.
6. Run your suite, then `toolgate list` to confirm everything loads.
