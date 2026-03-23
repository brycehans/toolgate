import { describe, expect, it } from 'bun:test'
import { testPolicy } from './testing'
import { definePolicy, allow, deny, next } from './index'
import type { Policy } from './types'

function p(name: string, handler: Policy['handler']): Policy {
  return { name, description: `test: ${name}`, handler }
}

describe('testPolicy', () => {
  it('passes when expectations match', async () => {
    const policy = definePolicy([
      p('allow-read', async (call) => call.tool === 'Read' ? allow() : next()),
      p('deny-rest', async () => deny()),
    ])

    // Should not throw
    await testPolicy(policy, [
      { tool: 'Read', args: {}, expect: 'allow' },
      { tool: 'Bash', args: { command: 'rm -rf /' }, expect: 'deny' },
    ])
  })

  it('throws when expectation does not match', async () => {
    const policy = definePolicy([
      p('deny-all', async () => deny()),
    ])

    expect(
      testPolicy(policy, [
        { tool: 'Read', args: {}, expect: 'allow' },
      ])
    ).rejects.toThrow()
  })
})
