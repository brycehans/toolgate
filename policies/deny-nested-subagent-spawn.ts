import { isSubagent, type Policy } from "../src";

/**
 * Cap agent nesting: a subagent may not spawn further subagents.
 *
 * Claude Code's PreToolUse payload tags subagent calls with `agent_type`
 * (surfaced as `call.context.agentType`) but carries NO nesting-depth counter
 * or parent-agent pointer. So the only depth signal available deterministically
 * at hook time is the binary "is the spawner itself a subagent?" — which lets us
 * enforce a maximum nesting depth of 1 (main agent → subagent, but no
 * subagent → sub-subagent). Enforcing an arbitrary "N levels deep" limit would
 * require a depth field the CLI does not expose today (see the `max_depth` gate
 * proposed in anthropics/claude-code#45427).
 *
 * This is a sample subagent-targeting policy: it demonstrates gating a call
 * based on WHO is making it (a subagent) rather than what the call is.
 *
 * OPT-IN — intentionally NOT registered in policies/index.ts, since blocking
 * all nested agents is opinionated. Enable it per-project by importing it into
 * a toolgate.config.ts:
 *
 *   import { definePolicy } from "@brycehanscomb/toolgate";
 *   import denyNestedSubagentSpawn from "@brycehanscomb/toolgate/policies/deny-nested-subagent-spawn";
 *   export default definePolicy([denyNestedSubagentSpawn]);
 */
const denyNestedSubagentSpawn: Policy = {
  name: "Deny nested subagent spawning",
  description:
    "Blocks a subagent from spawning further subagents, capping agent nesting at one level",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Agent") return;
    if (!isSubagent(call)) return;

    const spawner = call.context.agentType;
    const requested = typeof call.args.subagent_type === "string"
      ? call.args.subagent_type
      : "unknown";

    return `Nested subagent spawning blocked: a "${spawner}" subagent may not spawn another subagent ("${requested}"). Agent nesting is capped at one level — return the work to the main agent instead.`;
  },
};
export default denyNestedSubagentSpawn;
