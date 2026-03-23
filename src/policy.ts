import type { Middleware, ToolCall, VerdictResult } from './types'
import { isVerdictResult, next, NEXT } from './verdicts'

export function definePolicy(middlewares: Middleware[]): Middleware[] {
  return middlewares
}

export async function runPolicy(middlewares: Middleware[], call: ToolCall): Promise<VerdictResult> {
  for (let i = 0; i < middlewares.length; i++) {
    const result = await middlewares[i](call)

    if (!isVerdictResult(result)) {
      throw new Error(
        `toolgate: middleware[${i}] returned invalid verdict: ${JSON.stringify(result)}\n` +
        `  Every middleware must return allow(), deny(), or next().`
      )
    }

    if (result.verdict !== NEXT) {
      return result
    }
  }

  return next()
}
