import { describe, expect, it } from 'bun:test'
import { buildToolCall, buildHookResponse } from './runner'
import { allow, deny, next } from './verdicts'

describe('buildToolCall', () => {
  it('maps hook input to ToolCall', () => {
    const hookInput = {
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      cwd: '/home/user/project',
      session_id: 'abc',
    }

    const call = buildToolCall(hookInput)
    expect(call.tool).toBe('Bash')
    expect(call.args).toEqual({ command: 'echo hello' })
    expect(call.context.cwd).toBe('/home/user/project')
  })
})

describe('buildHookResponse', () => {
  it('maps allow to permissionDecision allow', () => {
    const response = buildHookResponse(allow())
    expect(response.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  it('maps deny to permissionDecision deny with reason', () => {
    const response = buildHookResponse(deny('bad'))
    expect(response.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(response.hookSpecificOutput.permissionDecisionReason).toBe('bad')
  })

  it('maps deny without reason', () => {
    const response = buildHookResponse(deny())
    expect(response.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(response.hookSpecificOutput.permissionDecisionReason).toBe('toolgate: denied by policy')
  })

  it('maps next (chain exhausted) to ask', () => {
    const response = buildHookResponse(next())
    expect(response.hookSpecificOutput.permissionDecision).toBe('ask')
  })
})
