import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Middleware } from './types'

const CONFIG_FILENAME = 'toolgate.config.ts'

export async function findProjectConfig(cwd: string): Promise<string | null> {
  const rootConfig = join(cwd, CONFIG_FILENAME)
  if (existsSync(rootConfig)) return rootConfig

  const claudeConfig = join(cwd, '.claude', CONFIG_FILENAME)
  if (existsSync(claudeConfig)) return claudeConfig

  return null
}

export function findGlobalConfig(): string {
  return join(homedir(), '.claude', CONFIG_FILENAME)
}

export async function loadConfigFile(path: string): Promise<Middleware[]> {
  const mod = await import(path)
  const middlewares = mod.default
  if (!Array.isArray(middlewares)) {
    throw new Error(`toolgate: config at ${path} must export a default array of middleware`)
  }
  return middlewares
}

export async function loadConfigs(cwd: string): Promise<Middleware[]> {
  const middlewares: Middleware[] = []

  const projectPath = await findProjectConfig(cwd)
  if (projectPath) {
    middlewares.push(...await loadConfigFile(projectPath))
  }

  const globalPath = findGlobalConfig()
  if (existsSync(globalPath)) {
    middlewares.push(...await loadConfigFile(globalPath))
  }

  return middlewares
}
