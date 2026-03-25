import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { loadConfigs } from './config'
import { runPolicyWithTrace } from './policy'
import { ALLOW, DENY, NEXT } from './verdicts'
import type { ToolCall } from './types'

interface SettingsJson {
  permissions?: {
    allow?: string[]
    deny?: string[]
    ask?: string[]
  }
}

/**
 * Parse a Claude Code permission rule into a tool name and sample args
 * for testing against the policy chain.
 *
 * Formats:
 *   "Bash(git status:*)"  → { tool: "Bash", args: { command: "git status" } }
 *   "Bash(git status)"    → { tool: "Bash", args: { command: "git status" } }
 *   "WebFetch(domain:x)"  → { tool: "WebFetch", args: { url: "https://x/test" } }
 *   "Skill(name)"         → { tool: "Skill", args: { skill: "name" } }
 *   "mcp__server__tool"   → { tool: "mcp__server__tool", args: {} }
 *   "Agent"               → { tool: "Agent", args: { ... } }
 */
function parseRule(rule: string): { tool: string; args: Record<string, any> } | null {
  // Bash(command:*)  or  Bash(command)
  const bashMatch = rule.match(/^Bash\((.+?)(?::.*?)?\)$/)
  if (bashMatch) {
    return { tool: 'Bash', args: { command: bashMatch[1] } }
  }

  // WebFetch(domain:xxx)
  const webMatch = rule.match(/^WebFetch\(domain:(.+)\)$/)
  if (webMatch) {
    return { tool: 'WebFetch', args: { url: `https://${webMatch[1]}/test`, prompt: 'test' } }
  }

  // Skill(name)
  const skillMatch = rule.match(/^Skill\((.+)\)$/)
  if (skillMatch) {
    return { tool: 'Skill', args: { skill: skillMatch[1] } }
  }

  // Agent
  if (rule === 'Agent') {
    return { tool: 'Agent', args: { prompt: 'test', subagent_type: 'Explore', description: 'test' } }
  }

  // MCP tools (mcp__server__tool)
  if (rule.startsWith('mcp__')) {
    return { tool: rule, args: {} }
  }

  return null
}

function findSettings(cwd: string): string[] {
  const paths: string[] = []

  // Project-level settings
  const projectLocal = join(cwd, '.claude', 'settings.local.json')
  if (existsSync(projectLocal)) paths.push(projectLocal)

  const projectShared = join(cwd, '.claude', 'settings.json')
  if (existsSync(projectShared)) paths.push(projectShared)

  // User-level settings
  const userLocal = join(homedir(), '.claude', 'settings.local.json')
  if (existsSync(userLocal)) paths.push(userLocal)

  const userShared = join(homedir(), '.claude', 'settings.json')
  if (existsSync(userShared)) paths.push(userShared)

  return paths
}

function readAllowRules(path: string): string[] {
  try {
    const content = readFileSync(path, 'utf-8')
    const settings: SettingsJson = JSON.parse(content)
    return settings.permissions?.allow ?? []
  } catch {
    return []
  }
}

interface AuditResult {
  rule: string
  verdict: 'allow' | 'deny' | 'ask'
  policyName?: string
  policyIndex?: number
  policyDescription?: string
  parseError?: boolean
}

export async function auditPermissions(format: 'table' | 'json' = 'table'): Promise<void> {
  const cwd = process.cwd()
  const settingsFiles = findSettings(cwd)

  if (settingsFiles.length === 0) {
    console.error('No Claude Code settings files found.')
    process.exit(1)
  }

  const policies = await loadConfigs(cwd)
  const projectRoot = cwd

  const results: { file: string; results: AuditResult[] }[] = []

  for (const settingsPath of settingsFiles) {
    const rules = readAllowRules(settingsPath)
    if (rules.length === 0) continue

    const fileResults: AuditResult[] = []

    for (const rule of rules) {
      const parsed = parseRule(rule)
      if (!parsed) {
        fileResults.push({ rule, verdict: 'ask', parseError: true })
        continue
      }

      const call: ToolCall = {
        tool: parsed.tool,
        args: parsed.args,
        context: {
          cwd,
          env: Object.fromEntries(
            Object.entries(process.env).filter(([, v]) => v !== undefined)
          ) as Record<string, string>,
          projectRoot,
        },
      }

      const { result, index, name, description } = await runPolicyWithTrace(policies, call)

      const verdict =
        result.verdict === ALLOW ? 'allow' as const :
        result.verdict === DENY ? 'deny' as const :
        'ask' as const

      fileResults.push({
        rule,
        verdict,
        policyName: name ?? undefined,
        policyIndex: index >= 0 ? index : undefined,
        policyDescription: description ?? undefined,
      })
    }

    results.push({ file: settingsPath, results: fileResults })
  }

  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  // Table format
  for (const { file, results: fileResults } of results) {
    const redundant = fileResults.filter(r => r.verdict === 'allow')
    const denied = fileResults.filter(r => r.verdict === 'deny')
    const needed = fileResults.filter(r => r.verdict === 'ask' && !r.parseError)
    const unparsed = fileResults.filter(r => r.parseError)

    console.log(`\n${'─'.repeat(60)}`)
    console.log(`📄 ${file}`)
    console.log(`   ${fileResults.length} rules total: ${redundant.length} redundant, ${needed.length} needed, ${denied.length} denied, ${unparsed.length} unparsed`)
    console.log(`${'─'.repeat(60)}`)

    if (redundant.length > 0) {
      console.log(`\n🟢 REDUNDANT (${redundant.length}) — already handled by toolgate, safe to remove:`)
      for (const r of redundant) {
        console.log(`   ${r.rule}`)
        console.log(`     → ${r.policyName} (index ${r.policyIndex})`)
      }
    }

    if (denied.length > 0) {
      console.log(`\n🔴 DENIED (${denied.length}) — toolgate would block these:`)
      for (const r of denied) {
        console.log(`   ${r.rule}`)
        console.log(`     → ${r.policyName}: ${r.policyDescription}`)
      }
    }

    if (needed.length > 0) {
      console.log(`\n🟡 NEEDED (${needed.length}) — no toolgate policy covers these:`)

      // Group by prefix for suggestions
      const groups = new Map<string, string[]>()
      for (const r of needed) {
        const prefix = categorize(r.rule)
        if (!groups.has(prefix)) groups.set(prefix, [])
        groups.get(prefix)!.push(r.rule)
      }

      for (const [group, rules] of groups) {
        console.log(`\n   [${group}] (${rules.length} rules)`)
        for (const rule of rules) {
          console.log(`     ${rule}`)
        }
      }
    }

    if (unparsed.length > 0) {
      console.log(`\n⚪ UNPARSED (${unparsed.length}) — could not generate test for:`)
      for (const r of unparsed) {
        console.log(`   ${r.rule}`)
      }
    }
  }

  // Summary
  const totalRedundant = results.reduce((n, r) => n + r.results.filter(x => x.verdict === 'allow').length, 0)
  if (totalRedundant > 0) {
    console.log(`\n${'═'.repeat(60)}`)
    console.log(`💡 ${totalRedundant} rules can be removed from settings files.`)
    console.log(`${'═'.repeat(60)}`)
  }
}

function categorize(rule: string): string {
  if (rule.startsWith('Bash(git ')) return 'git'
  if (rule.startsWith('Bash(gh ')) return 'gh'
  if (rule.startsWith('Bash(docker')) return 'docker'
  if (rule.startsWith('Bash(php ') || rule.startsWith('Bash(composer ')) return 'php'
  if (rule.startsWith('Bash(./artisan') || rule.includes('artisan.sh')) return 'laravel'
  if (rule.startsWith('Bash(./test.sh')) return 'laravel'
  if (rule.startsWith('Bash(npm ') || rule.startsWith('Bash(npx ') || rule.startsWith('Bash(pnpm ')) return 'node'
  if (rule.startsWith('WebFetch')) return 'webfetch'
  if (rule.startsWith('Skill')) return 'skill'
  if (rule.startsWith('mcp__')) return 'mcp'
  return 'shell'
}
