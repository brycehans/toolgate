import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { findProjectConfig, findGlobalConfig } from './config'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

describe('findProjectConfig', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'toolgate-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  it('finds toolgate.config.ts in cwd', async () => {
    const configPath = join(tempDir, 'toolgate.config.ts')
    await writeFile(configPath, 'export default []')
    expect(await findProjectConfig(tempDir)).toBe(configPath)
  })

  it('finds .claude/toolgate.config.ts in cwd', async () => {
    await mkdir(join(tempDir, '.claude'), { recursive: true })
    const configPath = join(tempDir, '.claude', 'toolgate.config.ts')
    await writeFile(configPath, 'export default []')
    expect(await findProjectConfig(tempDir)).toBe(configPath)
  })

  it('prefers root config over .claude/ config', async () => {
    const rootConfig = join(tempDir, 'toolgate.config.ts')
    await mkdir(join(tempDir, '.claude'), { recursive: true })
    const claudeConfig = join(tempDir, '.claude', 'toolgate.config.ts')
    await writeFile(rootConfig, 'export default []')
    await writeFile(claudeConfig, 'export default []')
    expect(await findProjectConfig(tempDir)).toBe(rootConfig)
  })

  it('returns null when no config found', async () => {
    expect(await findProjectConfig(tempDir)).toBeNull()
  })
})

describe('findGlobalConfig', () => {
  it('returns path under ~/.claude/', () => {
    const result = findGlobalConfig()
    expect(result).toContain('.claude/toolgate.config.ts')
  })
})
