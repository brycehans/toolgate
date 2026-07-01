import type { Policy } from "../src";
import {
  parseShell,
  hasUnsafeNodes,
  getArgs,
  getAndChainSegments,
} from "./parse-bash-ast";

/**
 * Flags that take their value as the next token (space-separated form).
 * Their values are user-supplied strings/paths but the command itself is
 * read-only, so the values don't need to be validated.
 */
const FLAGS_WITH_ARG = new Set([
  "-d",
  "--date",
  "-f",
  "--file",
  "-r",
  "--reference",
]);

function isSafeDateInvocation(tokens: string[]): boolean {
  if (tokens[0] !== "date") return false;

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];

    // Reject any form that sets the system clock
    if (t === "-s" || t === "--set" || t.startsWith("--set=")) return false;

    // Format string (+%Y-%m-%d etc.) — safe
    if (t.startsWith("+")) continue;

    // Long flag with = value (e.g. --rfc-3339=seconds, --date=...)
    if (t.startsWith("--") && t.includes("=")) continue;

    // Space-separated flag-with-value — skip the value token
    if (FLAGS_WITH_ARG.has(t)) {
      i++;
      continue;
    }

    // Bare flag — safe
    if (t.startsWith("-")) continue;

    // Bare positional argument (not a +format, not a flag) — this is the
    // syntax for setting the clock, e.g. `date 010100002025`. Reject.
    return false;
  }

  return true;
}

const allowDate: Policy = {
  name: "Allow date",
  description:
    "Permits the date command (and && chains of date commands) for reading and formatting time; rejects forms that set the system clock",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    const command = call.args?.command;
    if (typeof command !== "string") return;

    const file = await parseShell(command);
    if (!file) return;
    if (hasUnsafeNodes(file)) return;

    const segments = getAndChainSegments(file);
    if (!segments) return;

    for (const segment of segments) {
      const args = getArgs(segment);
      if (!args) return;
      if (!isSafeDateInvocation(args)) return;
    }

    return true;
  },
};
export default allowDate;
