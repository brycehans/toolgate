import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { findConfigInDir, findAllConfigs, loadConfigs } from './config'
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

describe('findConfigInDir', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'toolgate-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  it('finds toolgate.config.ts in dir', async () => {
    const configPath = join(tempDir, 'toolgate.config.ts')
    await writeFile(configPath, 'export default []')
    expect(findConfigInDir(tempDir)).toEqual([configPath])
  })

  it('finds .claude/toolgate.config.ts in dir', async () => {
    await mkdir(join(tempDir, '.claude'), { recursive: true })
    const configPath = join(tempDir, '.claude', 'toolgate.config.ts')
    await writeFile(configPath, 'export default []')
    expect(findConfigInDir(tempDir)).toEqual([configPath])
  })

  it('prefers root config over .claude/ config', async () => {
    const rootConfig = join(tempDir, 'toolgate.config.ts')
    await mkdir(join(tempDir, '.claude'), { recursive: true })
    const claudeConfig = join(tempDir, '.claude', 'toolgate.config.ts')
    await writeFile(rootConfig, 'export default []')
    await writeFile(claudeConfig, 'export default []')
    expect(findConfigInDir(tempDir)).toEqual([rootConfig])
  })

  it('returns empty array when no config found', () => {
    expect(findConfigInDir(tempDir)).toEqual([])
  })

  it('returns local config before shared config', async () => {
    const sharedConfig = join(tempDir, 'toolgate.config.ts')
    const localConfig = join(tempDir, 'toolgate.config.local.ts')
    await writeFile(sharedConfig, 'export default []')
    await writeFile(localConfig, 'export default []')
    expect(findConfigInDir(tempDir)).toEqual([localConfig, sharedConfig])
  })

  it('finds local config alone when no shared config exists', async () => {
    const localConfig = join(tempDir, 'toolgate.config.local.ts')
    await writeFile(localConfig, 'export default []')
    expect(findConfigInDir(tempDir)).toEqual([localConfig])
  })

  it('finds local config in .claude/ when no root local exists', async () => {
    await mkdir(join(tempDir, '.claude'), { recursive: true })
    const claudeLocal = join(tempDir, '.claude', 'toolgate.config.local.ts')
    await writeFile(claudeLocal, 'export default []')
    expect(findConfigInDir(tempDir)).toEqual([claudeLocal])
  })

  it('prefers root local over .claude/ local', async () => {
    await mkdir(join(tempDir, '.claude'), { recursive: true })
    const rootLocal = join(tempDir, 'toolgate.config.local.ts')
    const claudeLocal = join(tempDir, '.claude', 'toolgate.config.local.ts')
    await writeFile(rootLocal, 'export default []')
    await writeFile(claudeLocal, 'export default []')
    expect(findConfigInDir(tempDir)).toEqual([rootLocal])
  })
})

describe('findAllConfigs', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'toolgate-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  it('returns empty array when no configs exist', () => {
    expect(findAllConfigs(tempDir)).toEqual([])
  })

  it('finds config in cwd', async () => {
    const configPath = join(tempDir, 'toolgate.config.ts')
    await writeFile(configPath, 'export default []')
    expect(findAllConfigs(tempDir)).toEqual([configPath])
  })

  it('finds configs in cwd and parent, innermost first', async () => {
    const parentConfig = join(tempDir, '.claude', 'toolgate.config.ts')
    await mkdir(join(tempDir, '.claude'), { recursive: true })
    await writeFile(parentConfig, 'export default []')

    const child = join(tempDir, 'child')
    await mkdir(child)
    const childConfig = join(child, 'toolgate.config.ts')
    await writeFile(childConfig, 'export default []')

    expect(findAllConfigs(child)).toEqual([childConfig, parentConfig])
  })

  it('skips directories without configs', async () => {
    const parentConfig = join(tempDir, 'toolgate.config.ts')
    await writeFile(parentConfig, 'export default []')

    const child = join(tempDir, 'a', 'b')
    await mkdir(child, { recursive: true })

    expect(findAllConfigs(child)).toEqual([parentConfig])
  })

  it('dedupes a symlinked config against its real file, keeping the innermost', async () => {
    // Real config in the child; parent's .claude/ holds a symlink to it — the
    // "one file in the project, symlinked at $HOME level for global reach" setup.
    const child = join(tempDir, 'child')
    await mkdir(child)
    const realConfig = join(child, 'toolgate.config.ts')
    await writeFile(realConfig, 'export default []')

    await mkdir(join(tempDir, '.claude'), { recursive: true })
    await symlink(realConfig, join(tempDir, '.claude', 'toolgate.config.ts'))

    expect(findAllConfigs(child)).toEqual([realConfig])
  })

  it('still finds a symlinked config when the walk never passes the real file', async () => {
    const elsewhere = join(tempDir, 'elsewhere')
    await mkdir(elsewhere)
    const realConfig = join(elsewhere, 'toolgate.config.ts')
    await writeFile(realConfig, 'export default []')

    const linkPath = join(tempDir, 'toolgate.config.ts')
    await symlink(realConfig, linkPath)

    const child = join(tempDir, 'child')
    await mkdir(child)

    expect(findAllConfigs(child)).toEqual([linkPath])
  })

  it('orders local before shared at each level when walking up', async () => {
    const parentShared = join(tempDir, 'toolgate.config.ts')
    const parentLocal = join(tempDir, 'toolgate.config.local.ts')
    await writeFile(parentShared, 'export default []')
    await writeFile(parentLocal, 'export default []')

    const child = join(tempDir, 'child')
    await mkdir(child)
    const childShared = join(child, 'toolgate.config.ts')
    const childLocal = join(child, 'toolgate.config.local.ts')
    await writeFile(childShared, 'export default []')
    await writeFile(childLocal, 'export default []')

    expect(findAllConfigs(child)).toEqual([
      childLocal,
      childShared,
      parentLocal,
      parentShared,
    ])
  })
})

describe('loadConfigs', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'toolgate-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  it('continues loading when a config file has errors', async () => {
    // Parent with broken config
    await writeFile(join(tempDir, 'toolgate.config.ts'), 'import "nonexistent-package"; export default []')

    // Child with valid config
    const child = join(tempDir, 'child')
    await mkdir(child)
    await writeFile(join(child, 'toolgate.config.ts'), 'export default []')

    // Should not throw — broken parent is skipped, builtin policies still load
    const policies = await loadConfigs(child)
    expect(policies.length).toBeGreaterThan(0)
  })

  it('includes builtin policies even when no configs exist', async () => {
    const policies = await loadConfigs(tempDir)
    expect(policies.length).toBeGreaterThan(0)
  })

  it('disables a builtin policy named in config `disable` export', async () => {
    await writeFile(
      join(tempDir, 'toolgate.config.ts'),
      `export default []\nexport const disable = ['Deny bash grep']`,
    )

    const policies = await loadConfigs(tempDir)
    expect(policies.some(p => p.name === 'Deny bash grep')).toBe(false)
    // other builtins still present
    expect(policies.some(p => p.name === 'Allow git log/show')).toBe(true)
  })

  it('disables a policy from an outer config', async () => {
    // parent defines a project policy; child disables it by name
    await writeFile(
      join(tempDir, 'toolgate.config.ts'),
      `export default [{ name: 'parent-policy', description: '', handler: async () => ({ kind: Symbol.for('next') }) }]`,
    )
    const child = join(tempDir, 'child')
    await mkdir(child)
    await writeFile(
      join(child, 'toolgate.config.ts'),
      `export default []\nexport const disable = ['parent-policy']`,
    )

    const policies = await loadConfigs(child)
    expect(policies.some(p => p.name === 'parent-policy')).toBe(false)
  })

  it('ignores unknown names in `disable` without throwing', async () => {
    await writeFile(
      join(tempDir, 'toolgate.config.ts'),
      `export default []\nexport const disable = ['no-such-policy']`,
    )

    const policies = await loadConfigs(tempDir)
    expect(policies.length).toBeGreaterThan(0)
  })

  it('ignores missing `disable` export', async () => {
    await writeFile(join(tempDir, 'toolgate.config.ts'), 'export default []')
    const policies = await loadConfigs(tempDir)
    expect(policies.length).toBeGreaterThan(0)
  })
})
