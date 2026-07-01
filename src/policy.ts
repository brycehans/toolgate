import type { Policy, ToolCall, VerdictResult } from './types'
import { isVerdictResult, next, NEXT } from './verdicts'
import { adaptHandler } from './adapter'

export function definePolicy(policies: Policy[]): Policy[] {
  return policies
}

export interface TracedResult {
  result: VerdictResult
  /** Index of the policy in the original input array, or -1 if all passed */
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
  // Partition into deny-first, allow-second, preserving relative order within each group.
  // Legacy policies (no action) run in their original position among allow policies.
  const denyPolicies: { policy: Policy; originalIndex: number }[] = []
  const allowPolicies: { policy: Policy; originalIndex: number }[] = []

  for (let i = 0; i < policies.length; i++) {
    const p = policies[i]
    if (p.action === 'deny') {
      denyPolicies.push({ policy: p, originalIndex: i })
    } else {
      allowPolicies.push({ policy: p, originalIndex: i })
    }
  }

  const ordered = [...denyPolicies, ...allowPolicies]

  for (const { policy, originalIndex } of ordered) {
    let result: VerdictResult

    if (policy.action) {
      // New-style policy: adapt simplified return values to VerdictResult
      const adapted = adaptHandler(policy.action, policy.handler as any)
      result = await adapted(call)
    } else {
      // Legacy policy (no action): handler returns VerdictResult directly
      result = await (policy.handler as any)(call)
    }

    if (!isVerdictResult(result)) {
      throw new Error(
        `toolgate: policy[${originalIndex}] "${policy.name}" returned invalid verdict: ${JSON.stringify(result)}\n` +
        `  Every policy handler must return allow(), deny(), or next().`
      )
    }

    if (result.verdict !== NEXT) {
      return { result, index: originalIndex, name: policy.name, description: policy.description }
    }
  }

  return { result: next(), index: -1, name: null, description: null }
}
