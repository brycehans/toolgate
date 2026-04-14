import type { Policy, ToolCall, VerdictResult } from './types'
import { isVerdictResult, next, NEXT } from './verdicts'

export function definePolicy(policies: Policy[]): Policy[] {
  return policies
}

export interface TracedResult {
  result: VerdictResult
  /** Index of the policy that returned the verdict, or -1 if all returned next() */
  index: number
  /** Name of the policy, if available */
  name: string | null
  /** Description of the policy, if available */
  description: string | null
}

export async function runPolicy(policies: Policy[], call: ToolCall): Promise<VerdictResult> {
  const { result } = await runPolicyWithTrace(policies, call)
  return result
}

export async function runPolicyWithTrace(policies: Policy[], call: ToolCall): Promise<TracedResult> {
  let lastWarn: { result: VerdictResult; index: number; name: string | null; description: string | null } | null = null

  for (let i = 0; i < policies.length; i++) {
    const policy = policies[i]
    const result = await policy.handler(call)

    if (!isVerdictResult(result)) {
      throw new Error(
        `toolgate: policy[${i}] "${policy.name}" returned invalid verdict: ${JSON.stringify(result)}\n` +
        `  Every policy handler must return allow(), deny(), or next().`
      )
    }

    if (result.verdict !== NEXT) {
      return { result, index: i, name: policy.name, description: policy.description }
    }

    // Preserve the first NEXT-with-reason (from warn()) so it surfaces in the ask prompt
    if (!lastWarn && 'reason' in result && result.reason) {
      lastWarn = { result, index: i, name: policy.name, description: policy.description }
    }
  }

  return lastWarn ?? { result: next(), index: -1, name: null, description: null }
}
