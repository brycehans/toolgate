import { execSync } from 'child_process'

export function findGitRoot(cwd: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}
