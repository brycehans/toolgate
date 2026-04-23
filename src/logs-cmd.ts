import { homedir } from 'os'
import { join } from 'path'

const LOGS = [
  { name: 'Permission requests', file: 'permission-requests.jsonl' },
  { name: 'Tool failures', file: 'tool-failures.jsonl' },
]

export function logsCmd() {
  const claudeDir = join(homedir(), '.claude')
  for (const log of LOGS) {
    const path = join(claudeDir, log.file)
    console.log(`${log.name}: ${path}`)
  }
}
