#!/usr/bin/env bun
/**
 * Replay historical permission prompts through the CURRENT policy set.
 *
 * The permission-requests.jsonl log records tool calls that reached the
 * approval prompt. Each of those is friction that toolgate did not (or could
 * not) auto-resolve at the time. Replaying them through today's policies —
 * using each entry's ORIGINAL cwd, since config resolution walks up from cwd —
 * tells us:
 *   ALLOW → coverage since gained; this prompt would now be silent (value)
 *   ASK   → still prompts; roadmap candidate for a new policy (residual friction)
 *   DENY  → would now be blocked outright
 */
import { loadConfigs } from '../src/config'
import { runPolicy } from '../src/policy'
import { ALLOW, DENY, NEXT } from '../src/verdicts'
import { loadAdditionalDirs } from '../src/project-dirs'
import type { Policy, ToolCall } from '../src/types'

const LOG = `${process.env.HOME}/.claude/permission-requests.jsonl`

const env = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined),
) as Record<string, string>

// Cache loaded policy sets per cwd (config resolution is cwd-dependent).
const configCache = new Map<string, Policy[]>()
async function policiesFor(cwd: string): Promise<Policy[]> {
  if (!configCache.has(cwd)) configCache.set(cwd, await loadConfigs(cwd))
  return configCache.get(cwd)!
}

function summarize(entry: any): string {
  const t = entry.tool_name
  const i = entry.tool_input ?? {}
  if (t === 'Bash') return `Bash: ${i.command ?? ''}`
  if (t === 'WebFetch') return `WebFetch: ${i.url ?? ''}`
  if (t === 'Read' || t === 'Edit' || t === 'Write') return `${t}: ${i.file_path ?? ''}`
  return t
}

const lines = (await Bun.file(LOG).text()).split('\n').filter(Boolean)

let allow = 0, deny = 0, ask = 0, skipped = 0
const askByTool: Record<string, number> = {}
const askBashByHead: Record<string, number> = {}
const nowAllowedSamples: string[] = []

let n = 0
for (const line of lines) {
  let entry: any
  try { entry = JSON.parse(line) } catch { skipped++; continue }
  const tool = entry.tool_name
  const cwd = entry.cwd
  if (!tool || !cwd) { skipped++; continue }

  const call: ToolCall = {
    tool,
    args: entry.tool_input ?? {},
    context: { cwd, env, projectRoot: cwd, additionalDirs: loadAdditionalDirs(cwd) },
  }

  let verdict
  try {
    const policies = await policiesFor(cwd)
    const res = await runPolicy(policies, call)
    verdict = res.verdict
  } catch {
    skipped++; continue
  }

  if (verdict === ALLOW) {
    allow++
    if (nowAllowedSamples.length < 25) nowAllowedSamples.push(summarize(entry))
  } else if (verdict === DENY) {
    deny++
  } else {
    ask++
    askByTool[tool] = (askByTool[tool] ?? 0) + 1
    if (tool === 'Bash') {
      const cmd: string = entry.tool_input?.command ?? ''
      const head = cmd.trim().split(/\s+/).slice(0, 2).join(' ') || '(empty)'
      askBashByHead[head] = (askBashByHead[head] ?? 0) + 1
    }
  }

  if (++n % 500 === 0) console.error(`  ...${n}/${lines.length}`)
}

const total = allow + deny + ask
const pct = (x: number) => `${((x / total) * 100).toFixed(1)}%`

console.log('\n═══ REPLAY: historical prompts through current policies ═══')
console.log(`Log entries:        ${lines.length}`)
console.log(`Evaluated:          ${total}   (skipped ${skipped})`)
console.log(`Unique cwds:        ${configCache.size}`)
console.log('')
console.log(`Would now ALLOW:    ${allow}  ${pct(allow)}   ← friction that current policies eliminate`)
console.log(`Would now DENY:     ${deny}  ${pct(deny)}`)
console.log(`Still ASK:          ${ask}  ${pct(ask)}   ← residual friction / roadmap`)

console.log('\n─── Residual ASK by tool ───')
for (const [t, c] of Object.entries(askByTool).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(c).padStart(5)}  ${t}`)
}

console.log('\n─── Top still-prompting Bash command heads (roadmap) ───')
for (const [h, c] of Object.entries(askBashByHead).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${String(c).padStart(5)}  ${h}`)
}

console.log('\n─── Sample prompts current policies would now auto-allow ───')
for (const s of nowAllowedSamples) console.log(`  ✓ ${s.slice(0, 100)}`)
