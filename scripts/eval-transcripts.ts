#!/usr/bin/env bun
/**
 * Replay EVERY tool call from Claude Code transcripts through current policies.
 *
 * Unlike eval-replay.ts (which reads permission-requests.jsonl — only calls
 * that PROMPTED), this walks the full transcripts, so the denominator is every
 * tool call ever made. That lets us compute toolgate's true decision
 * distribution: of ALL calls, what fraction does it auto-ALLOW vs DENY vs ASK?
 *
 * Attribution caveat: the transcript records what ran, not the permission
 * decision that gated it. So we don't try to join against the prompt log —
 * we recompute the verdict directly. And in acceptEdits/bypassPermissions
 * sessions the real harness never prompted regardless of toolgate, so we
 * bucket by the permission mode active at each call. The `default`-mode bucket
 * is the one where toolgate's verdict is what actually gates the user.
 *
 * Limitation: uses TODAY's policies, so this is "what toolgate would decide
 * now," not a historical reconstruction.
 */
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { loadConfigs } from '../src/config'
import { runPolicy } from '../src/policy'
import { ALLOW, DENY } from '../src/verdicts'
import { loadAdditionalDirs } from '../src/project-dirs'
import type { Policy, ToolCall } from '../src/types'

const ROOT = `${process.env.HOME}/.claude/projects`
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined),
) as Record<string, string>

// Recursively collect every .jsonl transcript.
function findTranscripts(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) out.push(...findTranscripts(p))
    else if (name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

const configCache = new Map<string, Policy[]>()
async function policiesFor(cwd: string): Promise<Policy[]> {
  if (!configCache.has(cwd)) configCache.set(cwd, await loadConfigs(cwd))
  return configCache.get(cwd)!
}

type Bucket = { allow: number; deny: number; ask: number }
const zero = (): Bucket => ({ allow: 0, deny: 0, ask: 0 })

const byMode: Record<string, Bucket> = {}
const byToolDefault: Record<string, Bucket> = {} // per-tool, default mode only
const askHeadsDefault: Record<string, number> = {} // Bash ask heads, default mode
const seenToolUseIds = new Set<string>()

let total = 0, skippedNoCwd = 0, files = 0

// Extract per-call records from one transcript, tracking the active mode.
const transcripts = findTranscripts(ROOT)
console.error(`Found ${transcripts.length} transcripts`)

for (const file of transcripts) {
  files++
  let text: string
  try { text = await Bun.file(file).text() } catch { continue }
  let mode = 'default'
  for (const line of text.split('\n')) {
    if (!line) continue
    let o: any
    try { o = JSON.parse(line) } catch { continue }

    if (o.type === 'permission-mode' && o.permissionMode) { mode = o.permissionMode; continue }

    const content = o?.message?.content
    if (!Array.isArray(content)) continue
    const cwd = o.cwd

    for (const c of content) {
      if (c?.type !== 'tool_use') continue
      if (c.id && seenToolUseIds.has(c.id)) continue
      if (c.id) seenToolUseIds.add(c.id)

      const tool = c.name
      if (!tool) continue
      if (!cwd) { skippedNoCwd++; continue }

      const call: ToolCall = {
        tool,
        args: c.input ?? {},
        context: { cwd, env, projectRoot: cwd, additionalDirs: loadAdditionalDirs(cwd) },
      }

      let verdict
      try {
        verdict = (await runPolicy(await policiesFor(cwd), call)).verdict
      } catch { continue }

      total++
      const b = (byMode[mode] ??= zero())
      const key = verdict === ALLOW ? 'allow' : verdict === DENY ? 'deny' : 'ask'
      b[key]++

      if (mode === 'default') {
        const tb = (byToolDefault[tool] ??= zero())
        tb[key]++
        if (key === 'ask' && tool === 'Bash') {
          const cmd: string = c.input?.command ?? ''
          const head = cmd.trim().split(/\s+/).slice(0, 2).join(' ') || '(empty)'
          askHeadsDefault[head] = (askHeadsDefault[head] ?? 0) + 1
        }
      }

      if (total % 2000 === 0) console.error(`  ...${total} calls`)
    }
  }
}

const pct = (x: number, d: number) => (d ? `${((x / d) * 100).toFixed(1)}%` : '—')
const line = (label: string, b: Bucket) => {
  const t = b.allow + b.deny + b.ask
  return `  ${label.padEnd(20)} calls=${String(t).padStart(6)}  ALLOW ${pct(b.allow, t).padStart(6)}  DENY ${pct(b.deny, t).padStart(6)}  ASK ${pct(b.ask, t).padStart(6)}`
}

console.log('\n═══ TRANSCRIPT REPLAY: every tool call vs current policies ═══')
console.log(`Transcripts:        ${files}`)
console.log(`Tool calls scored:  ${total}   (skipped ${skippedNoCwd} w/o cwd)`)
console.log(`Unique cwds:        ${configCache.size}`)

console.log('\n─── By permission mode ───')
for (const [m, b] of Object.entries(byMode).sort((a, b) => (b[1].allow + b[1].deny + b[1].ask) - (a[1].allow + a[1].deny + a[1].ask))) {
  console.log(line(m, b))
}

const def = byMode['default']
if (def) {
  const t = def.allow + def.deny + def.ask
  console.log('\n─── DEFAULT mode = where toolgate actually gates ───')
  console.log(`  Auto-ALLOW rate (friction removed):  ${pct(def.allow, t)}  (${def.allow}/${t})`)
  console.log(`  DENY rate:                           ${pct(def.deny, t)}`)
  console.log(`  ASK rate (residual friction):        ${pct(def.ask, t)}`)

  console.log('\n─── Default-mode calls by tool ───')
  for (const [tool, b] of Object.entries(byToolDefault).sort((a, b) => (b[1].allow + b[1].deny + b[1].ask) - (a[1].allow + a[1].deny + a[1].ask)).slice(0, 15)) {
    console.log(line(tool, b))
  }

  console.log('\n─── Top still-ASKing Bash heads (default mode) ───')
  for (const [h, c] of Object.entries(askHeadsDefault).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(c).padStart(5)}  ${h}`)
  }
}
