import { allow, next, type ToolCall } from "../../src";

const ALLOWED_COMMANDS = new Set([
  "git status",
  "git diff",
  "git log --oneline -5",
]);

/**
 * Allow specific exact commands. No parsing needed — the command
 * must match exactly (after trimming whitespace).
 */
export default async function allowExactCommands(call: ToolCall) {
  if (call.tool !== "Bash") {
    return next();
  }

  if (typeof call.args.command !== "string") {
    return next();
  }

  if (ALLOWED_COMMANDS.has(call.args.command.trim())) {
    return allow();
  }

  return next();
}
