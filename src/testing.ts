import type { Policy, ToolCall } from './types'
import { runPolicy } from './policy'
import { ALLOW, DENY, NEXT } from './verdicts'

interface TestCase {
  tool: string
  args: Record<string, any>
  expect: 'allow' | 'deny' | 'ask'
  context?: Partial<ToolCall['context']>
}

const SYMBOL_TO_STRING = new Map<symbol, string>([
  [ALLOW, 'allow'],
  [DENY, 'deny'],
  [NEXT, 'ask'],
])

export async function testPolicy(policies: Policy[], cases: TestCase[]): Promise<void> {
  for (const tc of cases) {
    const call: ToolCall = {
      tool: tc.tool,
      args: tc.args,
      context: {
        cwd: tc.context?.cwd ?? process.cwd(),
        env: tc.context?.env ?? {},
        projectRoot: tc.context?.projectRoot ?? null,
      },
    }

    const result = await runPolicy(policies, call)
    const actual = SYMBOL_TO_STRING.get(result.verdict) ?? 'unknown'

    if (actual !== tc.expect) {
      throw new Error(
        `toolgate test failed: ${tc.tool} ${JSON.stringify(tc.args)}\n` +
        `  Expected: ${tc.expect}\n` +
        `  Actual:   ${actual}`
      )
    }
  }
}
