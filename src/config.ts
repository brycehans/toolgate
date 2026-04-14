import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import type { Policy } from './types'
import { builtinPolicies } from '../policies'

const CONFIG_FILENAME = 'toolgate.config.ts'
const LOCAL_CONFIG_FILENAME = 'toolgate.config.local.ts'

/**
 * Find configs in a single directory. Returns paths in priority order:
 * local (personal, gitignored) before shared (committed). Within each
 * variant, prefers `./` over `./.claude/`.
 */
export function findConfigInDir(dir: string): string[] {
  const configs: string[] = []

  const rootLocal = join(dir, LOCAL_CONFIG_FILENAME)
  const claudeLocal = join(dir, '.claude', LOCAL_CONFIG_FILENAME)
  if (existsSync(rootLocal)) configs.push(rootLocal)
  else if (existsSync(claudeLocal)) configs.push(claudeLocal)

  const rootShared = join(dir, CONFIG_FILENAME)
  const claudeShared = join(dir, '.claude', CONFIG_FILENAME)
  if (existsSync(rootShared)) configs.push(rootShared)
  else if (existsSync(claudeShared)) configs.push(claudeShared)

  return configs
}

/**
 * Walk from cwd up to $HOME, collecting all toolgate configs.
 * Returns innermost first (most specific takes priority); within a
 * directory, local configs come before shared ones.
 */
export function findAllConfigs(cwd: string): string[] {
  const home = homedir()
  const configs: string[] = []
  let dir = cwd

  while (true) {
    configs.push(...findConfigInDir(dir))

    if (dir === home || dir === '/') break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return configs
}

export async function loadConfigFile(path: string): Promise<Policy[]> {
  const mod = await import(path)
  const policies = mod.default
  if (!Array.isArray(policies)) {
    throw new Error(`toolgate: config at ${path} must export a default array of policies`)
  }
  return policies
}

export async function loadConfigs(cwd: string): Promise<Policy[]> {
  const policies: Policy[] = []

  for (const configPath of findAllConfigs(cwd)) {
    try {
      policies.push(...await loadConfigFile(configPath))
    } catch (err) {
      console.error(`toolgate: failed to load config ${configPath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  policies.push(...builtinPolicies)

  return policies
}
