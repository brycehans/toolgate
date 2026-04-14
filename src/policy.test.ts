import { describe, expect, it } from 'bun:test'
import { definePolicy, runPolicy } from './policy'
import { allow, deny, next, warn, ALLOW, DENY, NEXT } from './verdicts'
import type { Policy, ToolCall } from './types'

const fakeCall: ToolCall = {
  tool: 'Read',
  args: { file_path: '/foo' },
  context: { cwd: '/tmp', env: {}, projectRoot: '/tmp' },
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
    expect('reason' in result).toBe(false)
  })

  it('preserves warn reason when all policies return next', async () => {
    const policy = definePolicy([
      p('a', async () => next()),
      p('b', async () => warn('sensitive')),
      p('c', async () => next()),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(NEXT)
    expect((result as any).reason).toBe('⚠️  sensitive')
  })

  it('preserves first warn reason when multiple warns exist', async () => {
    const policy = definePolicy([
      p('a', async () => warn('first warning')),
      p('b', async () => warn('second warning')),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(NEXT)
    expect((result as any).reason).toBe('⚠️  first warning')
  })

  it('warn does not override a later allow or deny', async () => {
    const policy = definePolicy([
      p('a', async () => warn('careful')),
      p('b', async () => allow()),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(ALLOW)
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
