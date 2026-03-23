import { parse } from "shell-quote";
import { allow, next, type ToolCall } from "../../src";

/**
 * Allow simple `bun test` commands. Rejects compound commands,
 * shell substitutions, and multiline inputs.
 */
export default async function allowBunTest(call: ToolCall) {
  if (call.tool !== "Bash") {
    return next();
  }

  if (typeof call.args.command !== "string") {
    return next();
  }

  if (call.args.command.includes("\n")) {
    return next();
  }

  const tokens = parse(call.args.command);

  if (tokens.some((t) => typeof t !== "string")) {
    return next();
  }

  if (tokens.some((t) => typeof t === "string" && /[`$|;&(){}]/.test(t))) {
    return next();
  }

  if (tokens[0] === "bun" && tokens[1] === "test") {
    return allow();
  }

  return next();
}
