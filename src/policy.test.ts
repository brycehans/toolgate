import { describe, expect, it } from 'bun:test'
import { definePolicy, runPolicy } from './policy'
import { allow, deny, next, ALLOW, DENY, NEXT } from './verdicts'
import type { Policy, ToolCall } from './types'

const fakeCall: ToolCall = {
  tool: 'Read',
  args: { file_path: '/foo' },
  context: { cwd: '/tmp', env: {}, projectRoot: null },
}

function p(name: string, handler: Policy['handler']): Policy {
  return { name, description: `test policy: ${name}`, handler }
}

describe('definePolicy', () => {
  it('returns the policy array unchanged', () => {
    const policies = [p('test', async () => allow())]
    expect(definePolicy(policies)).toBe(policies)
  })
})

describe('runPolicy', () => {
  it('returns first non-next verdict', async () => {
    const policy = definePolicy([
      p('skip', async () => next()),
      p('allow-all', async () => allow()),
      p('deny-all', async () => deny('should not reach')),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(ALLOW)
  })

  it('returns deny with reason', async () => {
    const policy = definePolicy([
      p('blocker', async () => deny('blocked')),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(DENY)
    expect((result as any).reason).toBe('blocked')
  })

  it('returns implicit next when all return next', async () => {
    const policy = definePolicy([
      p('a', async () => next()),
      p('b', async () => next()),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(NEXT)
  })

  it('throws on undefined return from policy handler', async () => {
    const policy = definePolicy([
      p('bad', (async () => undefined) as any),
    ])
    expect(runPolicy(policy, fakeCall)).rejects.toThrow(/policy\[0\] "bad" returned invalid verdict/)
  })

  it('throws on string return from policy handler', async () => {
    const policy = definePolicy([
      p('bad', (async () => 'allow') as any),
    ])
    expect(runPolicy(policy, fakeCall)).rejects.toThrow(/policy\[0\] "bad" returned invalid verdict/)
  })
})
