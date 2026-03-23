import { describe, expect, it } from 'bun:test'
import { testPolicy } from './testing'
import { definePolicy, allow, deny, next } from './index'

describe('testPolicy', () => {
  it('passes when expectations match', async () => {
    const policy = definePolicy([
      async (call) => call.tool === 'Read' ? allow() : next(),
      async () => deny(),
    ])

    // Should not throw
    await testPolicy(policy, [
      { tool: 'Read', args: {}, expect: 'allow' },
      { tool: 'Bash', args: { command: 'rm -rf /' }, expect: 'deny' },
    ])
  })

  it('throws when expectation does not match', async () => {
    const policy = definePolicy([
      async () => deny(),
    ])

    expect(
      testPolicy(policy, [
        { tool: 'Read', args: {}, expect: 'allow' },
      ])
    ).rejects.toThrow()
  })
})
