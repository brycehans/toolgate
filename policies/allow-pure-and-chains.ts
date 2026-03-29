import { allow, next, type Policy } from "../src";
import {
  parseShell,
  hasUnsafeNodes,
  getArgs,
  getAndChainSegments,
} from "./parse-bash-ast";

/**
 * Commands that are provably side-effect-free:
 * - No filesystem writes
 * - No environment or cwd mutation
 * - No network activity
 * - No code execution (except parse-only modes like php -l)
 *
 * The value is either null (any args allowed) or a Set of
 * required first arguments (subcommand/flag constraints).
 *
 * NOTE: This is intentionally a strict subset. Commands like
 * `cat` or `grep` are handled by allow-safe-read-commands with
 * path-scoping checks. This list is only for commands where
 * ANY arguments are safe (or a specific flag makes them safe).
 */
const PURE_COMMANDS: Map<string, Set<string> | null> = new Map([
  ["php", new Set(["-l"])], // lint mode only — parses, never executes
  ["echo", null], // stdout only (redirects rejected by AST layer)
  ["test", null], // evaluates conditions, no side effects
  ["true", null], // always succeeds, no side effects
  ["false", null], // always fails, no side effects
]);

function isPureCommand(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const constraint = PURE_COMMANDS.get(tokens[0]);
  if (constraint === undefined) return false; // command not in allowlist
  if (constraint === null) return true; // any args allowed
  return tokens.length > 1 && constraint.has(tokens[1]); // required subcommand
}

/**
 * Allow && chains where EVERY segment is a provably side-effect-free command.
 *
 * Safety guarantee (layered):
 * 1. AST parser (shfmt) — correct tokenization, no string-split bugs
 * 2. getAndChainSegments — rejects redirections, $(), $VAR, assignments, ||, pipes
 * 3. isPureCommand — only side-effect-free commands in strict allowlist
 *
 * Since no segment can modify shell state (cwd, env, filesystem), each
 * segment runs as if in isolation. Pure functions compose safely.
 */
const allowPureAndChains: Policy = {
  name: "Allow pure command chains",
  description:
    "Permits && chains where every segment is a side-effect-free command (php -l, echo, test)",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    const command = call.args?.command;
    if (typeof command !== "string") return next();

    const file = await parseShell(command);
    if (!file) return next();
    if (hasUnsafeNodes(file)) return next();

    const segments = getAndChainSegments(file);
    if (!segments) return next();

    for (const segment of segments) {
      const args = getArgs(segment);
      if (!args) return next();
      if (!isPureCommand(args)) return next();
    }

    return allow();
  },
};
export default allowPureAndChains;
