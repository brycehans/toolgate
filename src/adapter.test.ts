import { describe, expect, it } from 'bun:test'
import { adaptHandler } from './adapter'
import { ALLOW, DENY, NEXT } from './verdicts'
import type { ToolCall } from './types'

const call: ToolCall = {
  tool: 'Read',
  args: { file_path: '/foo' },
  context: { cwd: '/tmp', env: {}, projectRoot: '/tmp' },
}

describe('adaptHandler', () => {
  describe('pass-through', () => {
    for (const [label, value] of [
      ['undefined', undefined],
      ['null', null],
      ['false', false],
    ] as const) {
      it(`treats ${label} as next (allow action)`, async () => {
        const run = adaptHandler('allow', async () => value as any)
        expect((await run(call)).verdict).toBe(NEXT)
      })
      it(`treats ${label} as next (deny action)`, async () => {
        const run = adaptHandler('deny', async () => value as any)
        expect((await run(call)).verdict).toBe(NEXT)
      })
    }
  })

  describe('allow action', () => {
    it('truthy return activates allow', async () => {
      const run = adaptHandler('allow', async () => true)
      expect((await run(call)).verdict).toBe(ALLOW)
    })
  })

  describe('deny action', () => {
    it('non-empty string return denies with that reason', async () => {
      const run = adaptHandler('deny', async () => 'blocked')
      const result = await run(call)
      expect(result.verdict).toBe(DENY)
      if (result.verdict === DENY) expect(result.reason).toBe('blocked')
    })

    it('true return denies without a reason', async () => {
      const run = adaptHandler('deny', async () => true)
      const result = await run(call)
      expect(result.verdict).toBe(DENY)
      if (result.verdict === DENY) expect(result.reason).toBeUndefined()
    })

    it('empty-string return denies without a reason (not an empty reason)', async () => {
      const run = adaptHandler('deny', async () => '')
      const result = await run(call)
      expect(result.verdict).toBe(DENY)
      if (result.verdict === DENY) expect(result.reason).toBeUndefined()
    })
  })
})
