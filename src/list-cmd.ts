import { findAllConfigs } from './config'
import { builtinPolicies } from '../policies'
import type { Policy } from './types'

function printPolicies(policies: Policy[], disabled: Set<string>): void {
  for (const policy of policies) {
    const tag = disabled.has(policy.name) ? ' (disabled)' : ''
    console.log(`  ${policy.name}${tag}`)
    console.log(`    ${policy.description}`)
  }
}

async function collectDisabled(cwd: string): Promise<Set<string>> {
  const disabled = new Set<string>()
  for (const configPath of findAllConfigs(cwd)) {
    try {
      const mod = await import(configPath)
      if (Array.isArray(mod.disable)) {
        for (const name of mod.disable) disabled.add(name)
      }
    } catch {}
  }
  return disabled
}

export async function listPolicies(): Promise<void> {
  const cwd = process.cwd()
  const disabled = await collectDisabled(cwd)
  let total = 0

  const configPaths = findAllConfigs(cwd)
  for (const configPath of configPaths) {
    try {
      const mod = await import(configPath)
      const policies: Policy[] = Array.isArray(mod.default) ? mod.default : []
      console.log(`Project (${configPath}):`)
      if (policies.length === 0) {
        console.log('  (none)')
      } else {
        printPolicies(policies, disabled)
      }
      total += policies.length
      console.log()
    } catch (err) {
      console.error(`  Failed to load: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log('Built-in:')
  if (builtinPolicies.length === 0) {
    console.log('  (none)')
  } else {
    printPolicies(builtinPolicies, disabled)
  }
  total += builtinPolicies.length
  console.log()

  const disabledCount = [...disabled].filter(n =>
    builtinPolicies.some(p => p.name === n) ||
    configPaths.length > 0
  ).length
  console.log(`${total} policies loaded${disabledCount > 0 ? `, ${disabledCount} disabled` : ''}.`)
}
