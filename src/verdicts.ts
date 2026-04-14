import type { VerdictResult } from './types'

export const ALLOW: unique symbol = Symbol('toolgate.allow')
export const DENY: unique symbol = Symbol('toolgate.deny')
export const NEXT: unique symbol = Symbol('toolgate.next')

const KNOWN_SYMBOLS = new Set([ALLOW, DENY, NEXT])

export function allow(): { verdict: typeof ALLOW } {
  return { verdict: ALLOW }
}

export function deny(reason?: string): { verdict: typeof DENY; reason?: string } {
  return reason !== undefined ? { verdict: DENY, reason } : { verdict: DENY }
}

export function next(): { verdict: typeof NEXT } {
  return { verdict: NEXT }
}

export function isVerdictResult(value: unknown): value is VerdictResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'verdict' in value &&
    KNOWN_SYMBOLS.has((value as any).verdict)
  )
}
