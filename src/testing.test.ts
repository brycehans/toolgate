import { describe, expect, it } from 'bun:test'
import { testPolicy } from './testing'
import { definePolicy } from './index'
import type { Policy } from './types'

function allowP(name: string, handler: Policy['handler']): Policy {
  return { name, description: `test: ${name}`, action: 'allow', handler }
}
function denyP(name: string, handler: Policy['handler']): Policy {
  return { name, description: `test: ${name}`, action: 'deny', handler }
}

describe('testPolicy', () => {
  it('passes when expectations match', async () => {
    const policy = definePolicy([
      allowP('allow-read', async (call) => call.tool === 'Read'),
      denyP('deny-non-read', async (call) => call.tool !== 'Read'),
    ])

    // Should not throw
    await testPolicy(policy, [
      { tool: 'Read', args: {}, expect: 'allow' },
      { tool: 'Bash', args: { command: 'rm -rf /' }, expect: 'deny' },
    ])
  })

  it('throws when expectation does not match', async () => {
    const policy = definePolicy([
      denyP('deny-all', async () => true),
    ])

    expect(
      testPolicy(policy, [
        { tool: 'Read', args: {}, expect: 'allow' },
      ])
    ).rejects.toThrow()
  })
})
