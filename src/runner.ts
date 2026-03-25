import type { ToolCall, VerdictResult } from './types'
import { ALLOW, DENY, NEXT } from './verdicts'
import { loadConfigs } from './config'
import { runPolicy } from './policy'
interface HookInput {
  tool_name: string
  tool_input: Record<string, any>
  cwd: string
  session_id?: string
  [key: string]: any
}

interface HookResponse {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'allow' | 'deny' | 'ask'
    permissionDecisionReason?: string
  }
}

export function buildToolCall(input: HookInput): ToolCall {
  return {
    tool: input.tool_name,
    args: input.tool_input,
    context: {
      cwd: input.cwd,
      env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>,
      projectRoot: input.cwd,
    },
  }
}

export function buildHookResponse(verdict: VerdictResult): HookResponse {
  if (verdict.verdict === ALLOW) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    }
  }

  if (verdict.verdict === DENY) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: ('reason' in verdict && verdict.reason) || 'toolgate: denied by policy',
      },
    }
  }

  // NEXT — chain exhausted, ask the user
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
    },
  }
}

export async function run(): Promise<void> {
  try {
    const input: HookInput = JSON.parse(await Bun.stdin.text())
    const call = buildToolCall(input)
    const policies = await loadConfigs(call.context.cwd)
    const verdict = await runPolicy(policies, call)
    const response = buildHookResponse(verdict)
    process.stdout.write(JSON.stringify(response))
    process.exit(0)
  } catch (err) {
    const reason = `toolgate error: ${err instanceof Error ? err.message : String(err)}`
    console.error(reason)
    const response = buildHookResponse({ verdict: DENY, reason })
    process.stdout.write(JSON.stringify(response))
    process.exit(0)
  }
}
