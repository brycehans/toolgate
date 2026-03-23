import { describe, expect, it } from 'bun:test'
import { definePolicy, runPolicy } from './policy'
import { allow, deny, next, ALLOW, DENY, NEXT } from './verdicts'
import type { ToolCall } from './types'

const fakeCall: ToolCall = {
  tool: 'Read',
  args: { file_path: '/foo' },
  context: { cwd: '/tmp', env: {}, projectRoot: null },
}

describe('definePolicy', () => {
  it('returns the middleware array unchanged', () => {
    const mw = [async () => allow()]
    expect(definePolicy(mw)).toBe(mw)
  })
})

describe('runPolicy', () => {
  it('returns first non-next verdict', async () => {
    const policy = definePolicy([
      async () => next(),
      async () => allow(),
      async () => deny('should not reach'),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(ALLOW)
  })

  it('returns deny with reason', async () => {
    const policy = definePolicy([
      async () => deny('blocked'),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(DENY)
    expect((result as any).reason).toBe('blocked')
  })

  it('returns implicit next when all return next', async () => {
    const policy = definePolicy([
      async () => next(),
      async () => next(),
    ])
    const result = await runPolicy(policy, fakeCall)
    expect(result.verdict).toBe(NEXT)
  })

  it('throws on undefined return from middleware', async () => {
    const policy = definePolicy([
      (async () => undefined) as any,
    ])
    expect(runPolicy(policy, fakeCall)).rejects.toThrow(/middleware\[0\] returned invalid verdict/)
  })

  it('throws on string return from middleware', async () => {
    const policy = definePolicy([
      (async () => 'allow') as any,
    ])
    expect(runPolicy(policy, fakeCall)).rejects.toThrow(/middleware\[0\] returned invalid verdict/)
  })
})
