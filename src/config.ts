import { existsSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { join, dirname, resolve } from 'path'
import type { Policy } from './types'
import { builtinPolicies } from '../policies'
import { setSafeDotPaths } from '../policies/safe-dot-paths'

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
 *
 * Deduped by realpath so a symlinked config (e.g. ~/.claude/toolgate.config.ts
 * pointing at a project checkout, to make it load for every cwd under home)
 * doesn't load its policies twice when the walk also passes the real file.
 */
export function findAllConfigs(cwd: string): string[] {
  const home = homedir()
  const configs: string[] = []
  const seen = new Set<string>()
  let dir = cwd

  while (true) {
    for (const config of findConfigInDir(dir)) {
      let real = config
      try {
        real = realpathSync(config)
      } catch {}
      if (seen.has(real)) continue
      seen.add(real)
      configs.push(config)
    }

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

/**
 * Load every config on the walk from cwd, then append the built-ins.
 *
 * Besides the default policy array, a config may export `disable` (policy
 * names to drop) and `safeDotPaths` (dot-prefixed trees the read policies may
 * enter; see policies/safe-dot-paths). Both accumulate across every config on
 * the walk. Relative `safeDotPaths` entries resolve against the declaring
 * config's directory.
 */
export async function loadConfigs(cwd: string): Promise<Policy[]> {
  const policies: Policy[] = []
  const disabled = new Set<string>()
  const safeDotPaths: string[] = []

  for (const configPath of findAllConfigs(cwd)) {
    try {
      const mod = await import(configPath)
      if (Array.isArray(mod.default)) policies.push(...mod.default)
      else throw new Error(`config at ${configPath} must export a default array of policies`)
      if (Array.isArray(mod.disable)) {
        for (const name of mod.disable) disabled.add(name)
      }
      if (Array.isArray(mod.safeDotPaths)) {
        for (const p of mod.safeDotPaths) {
          if (typeof p !== 'string') continue
          const isAnchored = p.startsWith('/') || p === '~' || p.startsWith('~/') || p.startsWith('$HOME') || p.startsWith('${HOME}')
          safeDotPaths.push(isAnchored ? p : resolve(dirname(configPath), p))
        }
      }
    } catch (err) {
      console.error(`toolgate: failed to load config ${configPath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  setSafeDotPaths(safeDotPaths)
  policies.push(...builtinPolicies)

  return policies.filter(p => !disabled.has(p.name))
}
