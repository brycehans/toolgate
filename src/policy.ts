import type { Policy, ToolCall, VerdictResult } from './types'
import { next, NEXT } from './verdicts'
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
    // Adapt the policy's simplified return value into a VerdictResult.
    const adapted = adaptHandler(policy.action, policy.handler)
    const result = await adapted(call)

    if (result.verdict !== NEXT) {
      return { result, index: originalIndex, name: policy.name, description: policy.description }
    }
  }

  return { result: next(), index: -1, name: null, description: null }
}
