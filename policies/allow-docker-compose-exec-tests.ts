import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";
import { matchesTestRunner } from "./_test-runners";

const COMPOSE_FLAGS_WITH_VALUE = new Set([
  "-f", "--file",
  "--env-file",
  "-p", "--project-name",
  "--project-directory",
  "--profile",
  "--ansi",
  "--progress",
  "--parallel",
]);

const EXEC_FLAGS_WITH_VALUE = new Set([
  "-u", "--user",
  "-w", "--workdir",
  "-e", "--env",
  "--index",
]);

// Boolean exec flags we permit (no value, just skip).
const EXEC_BOOLEAN_FLAGS = new Set([
  "-T",
  "--no-TTY",
  "-i", "--interactive",
  "-t", "--tty",
]);

// Exec flags whose presence should reject the command — they signal
// something other than a foreground test invocation.
const EXEC_FORBIDDEN_FLAGS = new Set([
  "-d", "--detach",
  "--privileged",
]);

/** Skip flags and return the index of the next positional, or null. */
function skipFlags(
  tokens: string[],
  start: number,
  flagsWithValue: Set<string>,
  booleanFlags: Set<string> | null,
  forbiddenFlags: Set<string> | null,
): number | null {
  let i = start;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.startsWith("-")) return i;
    if (forbiddenFlags && forbiddenFlags.has(t)) return null;
    if (t.includes("=")) {
      // --flag=value — must not be a forbidden flag
      const eqIdx = t.indexOf("=");
      const flagName = t.slice(0, eqIdx);
      if (forbiddenFlags && forbiddenFlags.has(flagName)) return null;
      i += 1;
      continue;
    }
    if (flagsWithValue.has(t)) {
      i += 2;
      continue;
    }
    if (!booleanFlags || booleanFlags.has(t)) {
      i += 1;
      continue;
    }
    // Unknown flag — bail out conservatively.
    return null;
  }
  return null;
}

const allowDockerComposeExecTests: Policy = {
  name: "Allow docker compose exec test runners",
  description:
    "Permits `docker compose exec <service> <test-cmd>` when the inner command is a known test runner (php artisan test, phpunit, pest, bun test, pytest, etc.)",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] !== "docker" || tokens[1] !== "compose") return next();

    // Skip compose-level flags.
    const execIdx = skipFlags(tokens, 2, COMPOSE_FLAGS_WITH_VALUE, null, null);
    if (execIdx === null) return next();
    if (tokens[execIdx] !== "exec") return next();

    // Skip exec-level flags (rejecting forbidden ones).
    const serviceIdx = skipFlags(
      tokens,
      execIdx + 1,
      EXEC_FLAGS_WITH_VALUE,
      EXEC_BOOLEAN_FLAGS,
      EXEC_FORBIDDEN_FLAGS,
    );
    if (serviceIdx === null) return next();

    // Service name is a single positional, then the inner command begins.
    const innerStart = serviceIdx + 1;
    if (innerStart >= tokens.length) return next();

    return matchesTestRunner(tokens, innerStart) ? allow() : next();
  },
};

export default allowDockerComposeExecTests;
