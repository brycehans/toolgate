/**
 * Shared allowlist of test-runner command prefixes. Used by policies that
 * permit running a test runner in various contexts (docker compose exec,
 * subshell-wrapped cd, etc.).
 *
 * Each entry is an ordered token prefix. A command matches if its first
 * N tokens equal the prefix exactly; the rest are treated as opaque args.
 */
export const TEST_RUNNER_PREFIXES: readonly (readonly string[])[] = [
  // PHP / Laravel
  ["php", "artisan", "test"],
  ["php", "vendor/bin/phpunit"],
  ["php", "vendor/bin/pest"],
  ["php", "vendor/bin/phpstan"],
  ["vendor/bin/phpunit"],
  ["vendor/bin/pest"],
  ["vendor/bin/phpstan"],
  ["./vendor/bin/phpunit"],
  ["./vendor/bin/pest"],
  ["./vendor/bin/phpstan"],
  // JS / TS
  ["bun", "test"],
  ["npm", "test"],
  ["pnpm", "test"],
  ["yarn", "test"],
  // Python
  ["pytest"],
  ["python", "-m", "pytest"],
  ["python", "-m", "unittest"],
  ["python3", "-m", "pytest"],
  ["python3", "-m", "unittest"],
];

export function matchesTestRunner(tokens: string[], start = 0): boolean {
  for (const prefix of TEST_RUNNER_PREFIXES) {
    if (tokens.length - start < prefix.length) continue;
    let ok = true;
    for (let i = 0; i < prefix.length; i++) {
      if (tokens[start + i] !== prefix[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}
