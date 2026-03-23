import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { mkdir, writeFile, readFile } from 'fs/promises'

const TEMPLATE = `import { definePolicy, allow, deny, next } from 'toolgate'
import type { Middleware } from 'toolgate'

export default definePolicy([
  // Example: allow all file reads
  // async (call) => call.tool === 'Read' ? allow() : next(),

  // Default: no opinion (Claude Code prompts as normal)
  async () => next(),
])
`

export async function initGlobal(): Promise<void> {
  const claudeDir = join(homedir(), '.claude')
  const configPath = join(claudeDir, 'toolgate.config.ts')

  if (existsSync(configPath)) {
    console.log(`Global config already exists: ${configPath}`)
  } else {
    await mkdir(claudeDir, { recursive: true })
    await writeFile(configPath, TEMPLATE)
    console.log(`Created global config: ${configPath}`)
  }

  // Register hook in settings.json
  const settingsPath = join(claudeDir, 'settings.json')
  let settings: any = {}
  if (existsSync(settingsPath)) {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
  }

  if (!settings.hooks) settings.hooks = {}
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = []

  const hookEntry = {
    type: 'command',
    command: 'toolgate run',
  }

  const alreadyRegistered = settings.hooks.PreToolUse.some(
    (entry: any) =>
      entry.hooks?.some((h: any) => h.command === 'toolgate run') ||
      entry.command === 'toolgate run'
  )

  if (!alreadyRegistered) {
    settings.hooks.PreToolUse.push({
      hooks: [hookEntry],
    })
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
    console.log(`Registered PreToolUse hook in: ${settingsPath}`)
  } else {
    console.log('Hook already registered in settings.json')
  }
}

export async function initProject(cwd: string): Promise<void> {
  const configPath = join(cwd, 'toolgate.config.ts')

  if (existsSync(configPath)) {
    console.log(`Project config already exists: ${configPath}`)
    return
  }

  await writeFile(configPath, TEMPLATE)
  console.log(`Created project config: ${configPath}`)
}
