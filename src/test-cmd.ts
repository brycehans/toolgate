import { loadConfigs } from './config'
import { runPolicy } from './policy'
import { ALLOW, DENY, NEXT } from './verdicts'
import { findGitRoot } from './utils'
import type { ToolCall } from './types'

export async function testTool(tool: string, args: Record<string, any>): Promise<void> {
  const cwd = process.cwd()
  const call: ToolCall = {
    tool,
    args,
    context: {
      cwd,
      env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>,
      projectRoot: findGitRoot(cwd),
    },
  }

  const middlewares = await loadConfigs(cwd)

  if (middlewares.length === 0) {
    console.log('No policies loaded. Configure toolgate.config.ts first.')
    process.exit(1)
  }

  const result = await runPolicy(middlewares, call)

  const symbol = result.verdict
  if (symbol === ALLOW) {
    console.log('→ ALLOW')
  } else if (symbol === DENY) {
    const reason = 'reason' in result ? result.reason : undefined
    console.log(`→ DENY${reason ? `: ${reason}` : ''}`)
  } else if (symbol === NEXT) {
    console.log('→ ASK (no policy matched, Claude Code will prompt)')
  }
}
