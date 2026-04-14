import { existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { homedir } from 'os'
import { mkdir, writeFile, readFile } from 'fs/promises'
import { execSync } from 'child_process'

function findToolgateSrc(): string {
  try {
    const binPath = execSync('which toolgate', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
    const linkTarget = execSync(`readlink "${binPath}"`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
    const realPath = resolve(dirname(binPath), linkTarget)
    const pkgRoot = join(realPath, '..', '..')
    return join(pkgRoot, 'src', 'index')
  } catch {
    return 'toolgate'
  }
}

function projectTemplate(srcPath: string): string {
  return `import { definePolicy, allow, deny, next } from '${srcPath}'

export default definePolicy([
  // Example:
  // {
  //   name: 'Allow file reads',
  //   description: 'Permits all Read tool calls',
  //   handler: async (call) => call.tool === 'Read' ? allow() : next(),
  // },
])
`
}

export async function initGlobal(): Promise<void> {
  const claudeDir = join(homedir(), '.claude')
  const settingsPath = join(claudeDir, 'settings.json')

  await mkdir(claudeDir, { recursive: true })

  let settings: any = {}
  if (existsSync(settingsPath)) {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
  }

  if (!settings.hooks) settings.hooks = {}
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = []

  const alreadyRegistered = settings.hooks.PreToolUse.some(
    (entry: any) =>
      entry.hooks?.some((h: any) => h.command === 'toolgate run') ||
      entry.command === 'toolgate run'
  )

  if (!alreadyRegistered) {
    settings.hooks.PreToolUse.push({
      hooks: [{ type: 'command', command: 'toolgate run' }],
    })
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
    console.log(`Registered PreToolUse hook in: ${settingsPath}`)
  } else {
    console.log('Hook already registered in settings.json')
  }
}

const LOCAL_CONFIG_GITIGNORE_ENTRY = 'toolgate.config.local.ts'

async function ensureLocalConfigGitignored(cwd: string): Promise<void> {
  // Only touch .gitignore inside a git repo.
  if (!existsSync(join(cwd, '.git'))) return

  const gitignorePath = join(cwd, '.gitignore')
  let contents = ''
  if (existsSync(gitignorePath)) {
    contents = await readFile(gitignorePath, 'utf-8')
    const lines = contents.split('\n').map(l => l.trim())
    if (lines.includes(LOCAL_CONFIG_GITIGNORE_ENTRY)) return
  }

  const needsNewline = contents.length > 0 && !contents.endsWith('\n')
  const addition = (needsNewline ? '\n' : '') + LOCAL_CONFIG_GITIGNORE_ENTRY + '\n'
  await writeFile(gitignorePath, contents + addition)
  console.log(`Added ${LOCAL_CONFIG_GITIGNORE_ENTRY} to ${gitignorePath}`)
}

export async function initProject(cwd: string): Promise<void> {
  const configPath = join(cwd, 'toolgate.config.ts')

  if (existsSync(configPath)) {
    console.log(`Project config already exists: ${configPath}`)
  } else {
    const srcPath = findToolgateSrc()
    await writeFile(configPath, projectTemplate(srcPath))
    console.log(`Created project config: ${configPath}`)
  }

  await ensureLocalConfigGitignored(cwd)
}
