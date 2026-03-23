import { parse } from "shell-quote";
import { allow, next, type ToolCall } from "../../src";

/**
 * Allow simple `git add` commands. Rejects compound commands
 * (&&, ||, ;, |, etc.) and shell substitutions ($(), backticks).
 */
export default async function allowGitAdd(call: ToolCall) {
  if (call.tool !== "Bash") {
    return next();
  }

  if (typeof call.args.command !== "string") {
    return next();
  }

  // Newlines act as command separators in bash, but shell-quote
  // treats them as whitespace — reject multiline commands outright
  if (call.args.command.includes("\n")) {
    return next();
  }

  const tokens = parse(call.args.command);

  // Reject if any shell operators or substitutions are present
  if (tokens.some((t) => typeof t !== "string")) {
    return next();
  }

  // shell-quote doesn't always flag backticks or quoted $() as non-string,
  // so also reject if any token contains shell metacharacters
  if (tokens.some((t) => typeof t === "string" && /[`$|;&(){}]/.test(t))) {
    return next();
  }

  if (tokens[0] === "git" && tokens[1] === "add") {
    return allow();
  }

  return next();
}
