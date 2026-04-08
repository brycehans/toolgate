import { loadConfigs } from './config'
import { runPolicyWithTrace } from './policy'
import { ALLOW, DENY, NEXT } from './verdicts'
import type { ToolCall } from './types'
import { loadAdditionalDirs } from './project-dirs'

export async function testTool(tool: string, args: Record<string, any>, why = false): Promise<void> {
  const cwd = process.cwd()
  const call: ToolCall = {
    tool,
    args,
    context: {
      cwd,
      env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>,
      projectRoot: cwd,
      additionalDirs: loadAdditionalDirs(cwd),
    },
  }

  const policies = await loadConfigs(cwd)

  if (policies.length === 0) {
    console.log('No policies loaded. Configure toolgate.config.ts first.')
    process.exit(1)
  }

  const { result, index, name, description } = await runPolicyWithTrace(policies, call)

  const symbol = result.verdict
  if (symbol === ALLOW) {
    console.log('→ ALLOW')
  } else if (symbol === DENY) {
    const reason = 'reason' in result ? result.reason : undefined
    console.log(`→ DENY${reason ? `: ${reason}` : ''}`)
  } else if (symbol === NEXT) {
    console.log('→ ASK (no policy matched, Claude Code will prompt)')
  }

  if (why) {
    if (index === -1) {
      console.log(`  why: all ${policies.length} policies returned next()`)
    } else {
      const label = name || `policy[${index}]`
      console.log(`  why: ${label} (index ${index})`)
      if (description) {
        console.log(`  description: ${description}`)
      }
    }
  }
}
