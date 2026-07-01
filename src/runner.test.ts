import { describe, expect, it } from 'bun:test'
import { buildToolCall, buildHookResponse } from './runner'
import { isSubagent } from './project-dirs'
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

  it('leaves agent context undefined for main-agent calls', () => {
    const call = buildToolCall({ tool_name: 'Bash', tool_input: {}, cwd: '/p' })
    expect(call.context.agentType).toBeUndefined()
    expect(call.context.agentId).toBeUndefined()
  })

  it('threads agent_id/agent_type through for subagent calls', () => {
    const call = buildToolCall({
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
      cwd: '/p',
      agent_id: 'agent-123',
      agent_type: 'Explore',
    })
    expect(call.context.agentId).toBe('agent-123')
    expect(call.context.agentType).toBe('Explore')
  })
})

describe('isSubagent', () => {
  const ctx = (extra: Record<string, unknown>) => ({
    cwd: '/p', env: {}, projectRoot: '/p', additionalDirs: [], ...extra,
  })

  it('is true when agentType is set', () => {
    expect(isSubagent({ tool: 'Bash', args: {}, context: ctx({ agentType: 'Explore' }) })).toBe(true)
  })

  it('is false for main-agent calls', () => {
    expect(isSubagent({ tool: 'Bash', args: {}, context: ctx({}) })).toBe(false)
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
