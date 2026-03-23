#!/usr/bin/env bun

import { run } from './runner'
import { initGlobal, initProject } from './init'
import { testTool } from './test-cmd'
import { listPolicies } from './list-cmd'

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

  default:
    console.error('Usage: toolgate <run|init|test|list>')
    console.error('  run              Run policy chain (called by hooks)')
    console.error('  init             Set up global config + hook')
    console.error('  init --project   Set up project config')
    console.error('  test <tool> [args]  Dry-run a tool call')
    console.error('  list             List all loaded policies')
    process.exit(1)
}
