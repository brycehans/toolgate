# Subagent policies

Subagents (dispatched via the `Agent` tool) run their own tool calls through the **same policy chain** as the main agent, so every policy already applies to them. On top of that, you can write policies that gate on *who* is calling — allowing or denying a call specifically because it comes from a subagent — using `context.agentType` or the `isSubagent(call)` helper.

```ts
import type { Policy } from "@brycehanscomb/toolgate";
import { isSubagent } from "@brycehanscomb/toolgate";

const denySubagentPush: Policy = {
  name: "Deny subagent git push",
  description: "Subagents may not push to remotes",
  action: "deny",
  handler: async (call) => {
    if (!isSubagent(call)) return; // main agent → pass through
    if (call.tool === "Bash" && call.args.command?.startsWith("git push")) {
      return `Subagent (${call.context.agentType}) may not push`;
    }
  },
};

export default denySubagentPush;
```

The hook payload tells you *whether* the caller is a subagent (and its type via `context.agentType`), but not the numeric nesting depth or a parent-agent pointer — so the enforceable limit is "one level," not an arbitrary depth.

## The opt-in nested-spawn guard

Toolgate ships one such policy as an **opt-in** example: [`deny-nested-subagent-spawn`](../policies/deny-nested-subagent-spawn.ts), which stops a subagent from spawning further subagents (capping agent nesting at one level). It is intentionally *not* a built-in — enable it by importing it into a config:

```ts
import { definePolicy } from "@brycehanscomb/toolgate";
import denyNestedSubagentSpawn from "@brycehanscomb/toolgate/policies/deny-nested-subagent-spawn";

export default definePolicy([denyNestedSubagentSpawn]);
```
