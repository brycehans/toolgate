#!/usr/bin/env bun
/**
 * Red-team the policy set for FALSE NEGATIVES — dangerous tool calls that
 * get auto-ALLOWed. This is the one metric with a hard target: zero allows.
 *
 * Each case is a genuinely dangerous or should-be-reviewed call. A policy may
 * DENY it (best) or let it fall through to ASK (acceptable — the user still
 * sees it). ALLOW is a failure: toolgate waved through something dangerous.
 *
 * Run from a neutral cwd to emulate an arbitrary project (no local config).
 */
import { loadConfigs } from '../src/config'
import { runPolicy } from '../src/policy'
import { ALLOW, DENY } from '../src/verdicts'
import { loadAdditionalDirs } from '../src/project-dirs'
import type { ToolCall } from '../src/types'
import { redTeamCases as cases, type RedTeamCase as Case } from '../policies/tests/redteam-cases'

const CWD = '/tmp/toolgate-redteam' // neutral: emulates an arbitrary project
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined),
) as Record<string, string>

const policies = await loadConfigs(CWD)

const results: { c: Case; verdict: string; reason?: string }[] = []
for (const c of cases) {
  const call: ToolCall = {
    tool: c.tool,
    args: c.args,
    context: { cwd: CWD, env, projectRoot: CWD, additionalDirs: loadAdditionalDirs(CWD) },
  }
  const res = await runPolicy(policies, call)
  const verdict = res.verdict === ALLOW ? 'ALLOW' : res.verdict === DENY ? 'DENY' : 'ASK'
  const reason = res.verdict === DENY && 'reason' in res ? res.reason : undefined
  results.push({ c, verdict, reason })
}

const allowed = results.filter(r => r.verdict === 'ALLOW')
const denied = results.filter(r => r.verdict === 'DENY')
const asked = results.filter(r => r.verdict === 'ASK')

console.log('\n═══ RED TEAM: dangerous calls vs current policies ═══')
console.log(`Policies loaded:    ${policies.length}`)
console.log(`Cases:              ${results.length}`)
console.log(`DENY (blocked):     ${denied.length}`)
console.log(`ASK  (prompted):    ${asked.length}   ← acceptable: user still reviews`)
console.log(`ALLOW (LEAKED):     ${allowed.length}   ← ${allowed.length === 0 ? 'PASS ✅' : 'FALSE NEGATIVES ❌'}`)

if (allowed.length) {
  console.log('\n❌ FALSE NEGATIVES — auto-allowed dangerous calls:')
  for (const r of allowed) console.log(`   ${r.c.tool.padEnd(9)} ${r.c.desc}  ::  ${JSON.stringify(r.c.args).slice(0, 80)}`)
}

console.log('\n─── Full matrix ───')
for (const r of results) {
  const mark = r.verdict === 'ALLOW' ? '❌' : r.verdict === 'DENY' ? '🛑' : '❓'
  console.log(`  ${mark} ${r.verdict.padEnd(5)} ${r.c.desc}`)
}

process.exit(allowed.length === 0 ? 0 : 1)
