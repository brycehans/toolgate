/**
 * Bridge entry point that exposes toolgate's policy engine to OpenCode.
 * Accepts a JSON tool call on stdin, evaluates policies, outputs verdict.
 *
 * Usage: echo '{"tool":"Bash","args":{"command":"git push"},"cwd":"/path"}' | bun run src/bridge.ts
 */

import { buildToolCall } from "./runner"
import { loadConfigs } from "./config"
import { runPolicy } from "./policy"
import { ALLOW, ASK, DENY, NEXT } from "./verdicts"

const VERDICT_NAMES: Record<symbol, string> = {
  [ALLOW]: "allow",
  [DENY]: "deny",
  [ASK]: "ask",
  [NEXT]: "next",
}

async function main() {
  const raw = await Bun.stdin.text()
  const input = JSON.parse(raw)

  const cwd = input.cwd || process.cwd()
  const call = buildToolCall({
    tool_name: input.tool,
    tool_input: input.args || {},
    cwd,
    session_id: input.session_id,
  })

  const policies = await loadConfigs(cwd)
  const result = await runPolicy(policies, call)

  const output = {
    verdict: VERDICT_NAMES[result.verdict] || "next",
    reason: "reason" in result ? result.reason : undefined,
  }

  process.stdout.write(JSON.stringify(output))
  process.exit(0)
}

main().catch((err) => {
  const reason = `toolgate error: ${err instanceof Error ? err.message : String(err)}`
  process.stderr.write(reason + "\n")
  process.stdout.write(JSON.stringify({ verdict: "deny", reason }))
  process.exit(0)
})
