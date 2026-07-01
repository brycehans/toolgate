import { describe, expect, it } from 'bun:test'
import { definePolicy, runPolicy } from './policy'
import { ALLOW, DENY, NEXT } from './verdicts'
import type { Policy, ToolCall } from './types'

const fakeCall: ToolCall = {
  tool: 'Read',
  args: { file_path: '/foo' },
  context: { cwd: '/tmp', env: {}, projectRoot: '/tmp', additionalDirs: [] },
}

function p(name: string, action: 'allow' | 'deny', handler: Policy['handler']): Policy {
  return { name, description: `test policy: ${name}`, action, handler }
}

describe('definePolicy', () => {
  it('returns the policy array unchanged', () => {
    const policies = [p('test', 'allow', async () => true)]
    expect(definePolicy(policies)).toBe(policies)
  })
})

describe('runPolicy', () => {
  it('returns first activated verdict within the allow group', async () => {
    const policy = definePolicy([
      p('skip', 'allow', async () => undefined),
      p('allow-all', 'allow', async () => true),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(ALLOW)
  })

  it('returns deny with reason (string return)', async () => {
    const policy = definePolicy([
      p('blocker', 'deny', async () => 'blocked'),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(DENY)
    expect((result as any).reason).toBe('blocked')
  })

  it('returns deny without a reason (true return)', async () => {
    const policy = definePolicy([
      p('blocker', 'deny', async () => true),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(DENY)
    expect((result as any).reason).toBeUndefined()
  })

  it('runs deny policies before allow, regardless of array order', async () => {
    const policy = definePolicy([
      p('allow-all', 'allow', async () => true),
      p('blocker', 'deny', async () => 'blocked'),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(DENY)
  })

  it('treats falsy/void returns as pass-through', async () => {
    const policy = definePolicy([
      p('a', 'deny', async () => false),
      p('b', 'allow', async () => undefined),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(NEXT)
  })
})
