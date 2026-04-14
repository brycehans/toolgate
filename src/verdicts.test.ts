import { describe, expect, it } from 'bun:test'
import { allow, deny, next, ALLOW, DENY, NEXT, isVerdictResult } from './verdicts'

describe('verdict constructors', () => {
  it('allow() returns object with ALLOW symbol', () => {
    const result = allow()
    expect(result.verdict).toBe(ALLOW)
  })

  it('deny() returns object with DENY symbol', () => {
    const result = deny()
    expect(result.verdict).toBe(DENY)
    expect(result.reason).toBeUndefined()
  })

  it('deny(reason) includes reason', () => {
    const result = deny('blocked')
    expect(result.verdict).toBe(DENY)
    expect(result.reason).toBe('blocked')
  })

  it('next() returns object with NEXT symbol', () => {
    const result = next()
    expect(result.verdict).toBe(NEXT)
  })
})

describe('isVerdictResult', () => {
  it('accepts valid verdicts', () => {
    expect(isVerdictResult(allow())).toBe(true)
    expect(isVerdictResult(deny())).toBe(true)
    expect(isVerdictResult(deny('reason'))).toBe(true)
    expect(isVerdictResult(next())).toBe(true)
  })

  it('rejects invalid values', () => {
    expect(isVerdictResult(undefined)).toBe(false)
    expect(isVerdictResult(null)).toBe(false)
    expect(isVerdictResult('allow')).toBe(false)
    expect(isVerdictResult({ verdict: 'allow' })).toBe(false)
    expect(isVerdictResult({})).toBe(false)
  })
})
