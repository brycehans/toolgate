import { describe, expect, it } from 'bun:test'
import { buildToolCall, buildHookResponse } from './runner'
import { runPolicy } from './policy'
import { definePolicy, allow, deny, next } from './index'
import type { Policy } from './types'

function p(name: string, handler: Policy['handler']): Policy {
  return { name, description: `e2e: ${name}`, handler }
}

describe('end-to-end: hook input → policy → hook response', () => {
  const policy = definePolicy([
    p('allow-read', async (call) => call.tool === 'Read' ? allow() : next()),
    p('allow-localhost', async (call) => {
      if (call.tool === 'Bash' && call.args.command?.includes('localhost')) {
        return allow()
      }
      return next()
    }),
    p('deny-all', async () => deny('default deny')),
  ])

  it('allows Read tool', async () => {
    const hookInput = { tool_name: 'Read', tool_input: { file_path: '/foo' }, cwd: '/tmp' }
    const call = buildToolCall(hookInput)
    const verdict = await runPolicy(policy, call)
    const response = buildHookResponse(verdict)
    expect(response.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  it('allows localhost curl', async () => {
    const hookInput = { tool_name: 'Bash', tool_input: { command: 'curl http://localhost:3000' }, cwd: '/tmp' }
    const call = buildToolCall(hookInput)
    const verdict = await runPolicy(policy, call)
    const response = buildHookResponse(verdict)
    expect(response.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  it('denies external curl', async () => {
    const hookInput = { tool_name: 'Bash', tool_input: { command: 'curl https://evil.com' }, cwd: '/tmp' }
    const call = buildToolCall(hookInput)
    const verdict = await runPolicy(policy, call)
    const response = buildHookResponse(verdict)
    expect(response.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(response.hookSpecificOutput.permissionDecisionReason).toBe('default deny')
  })
})
