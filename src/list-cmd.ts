import { loadConfigs } from './config'

export async function listPolicies(): Promise<void> {
  const cwd = process.cwd()
  const policies = await loadConfigs(cwd)

  if (policies.length === 0) {
    console.log('No policies loaded. Configure toolgate.config.ts first.')
    process.exit(1)
  }

  for (const policy of policies) {
    console.log(`${policy.name}`)
    console.log(`  ${policy.description}`)
    console.log()
  }

  console.log(`${policies.length} policies loaded.`)
}
