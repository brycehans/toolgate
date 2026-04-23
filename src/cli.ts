#!/usr/bin/env bun

import { run } from './runner'
import { initGlobal, initProject } from './init'
import { testTool } from './test-cmd'
import { listPolicies } from './list-cmd'
import { auditPermissions } from './audit-cmd'
import { disableCmd } from './disable-cmd'
import { suspend } from './suspend'
import { logsCmd } from './logs-cmd'

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'run':
    await run()
    break

  case 'init':
    if (args.includes('--project')) {
      await initProject(process.cwd())
    } else {
      await initGlobal()
    }
    break

  case 'test':
    const why = args.includes('--why')
    const testArgs = args.filter(a => a !== '--why')
    const [toolName, argsJson] = testArgs
    if (!toolName) {
      console.error('Usage: toolgate test [--why] <tool> [args-json]')
      process.exit(1)
    }
    await testTool(toolName, argsJson ? JSON.parse(argsJson) : {}, why)
    break

  case 'list':
    await listPolicies()
    break

  case 'audit': {
    const auditFormat = args.includes('--json') ? 'json' as const : 'table' as const
    await auditPermissions(auditFormat)
    break
  }

  case 'disable':
    await disableCmd(args)
    break

  case 'suspend':
    await suspend()
    break

  case 'logs':
    logsCmd()
    break

  default:
    console.error('Usage: toolgate <run|init|test|list|audit|disable|suspend|logs>')
    console.error('  run              Run policy chain (called by hooks)')
    console.error('  init             Register PreToolUse hook')
    console.error('  init --project   Set up project config')
    console.error('  test <tool> [args]  Dry-run a tool call')
    console.error('  list             List all loaded policies')
    console.error('  audit            Audit settings.local.json against policies')
    console.error('  audit --json     Output audit as JSON')
    console.error('  disable          Interactively pick which policies to disable')
    console.error('    --shared       Target toolgate.config.ts (create in cwd if missing)')
    console.error('    --local        Target toolgate.config.local.ts (create in cwd if missing)')
    console.error('    --file=<path>  Target a specific config file (create if missing)')
    console.error('    --json         Dump all policies + disable state as JSON')
    console.error('  suspend          Suspend all policies (Ctrl+C to resume)')
    console.error('  logs             Show Claude Code log file locations')
    process.exit(1)
}
