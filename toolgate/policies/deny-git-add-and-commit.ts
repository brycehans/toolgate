import { parse } from "shell-quote";
import { deny, next, type Policy } from "../../src";

/**
 * Deny compound git add-and-commit commands. Forces the add and commit
 * steps to be separate tool calls.
 *
 * Splits on newlines first (shell-quote treats them as whitespace),
 * then parses each line to find git subcommands.
 */
const denyGitAddAndCommit: Policy = {
  name: "Deny git add-and-commit",
  description: "Blocks compound git add+commit commands, forcing separate steps",
  handler: async (call) => {
    if (call.tool !== "Bash") {
      return next();
    }

    if (typeof call.args.command !== "string") {
      return next();
    }

    const subcommands = findGitSubcommands(call.args.command);
    const hasAdd = subcommands.includes("add");
    const hasCommit = subcommands.includes("commit");

    if (hasAdd && hasCommit) {
      return deny("Split git add and git commit into separate steps");
    }

    return next();
  },
};
export default denyGitAddAndCommit;

/**
 * Parse a command string and return all git subcommands found.
 * Handles newlines, operators, and multiple commands in one string.
 */
function findGitSubcommands(command: string): string[] {
  const subcommands: string[] = [];

  // Split on newlines first since shell-quote eats them
  for (const line of command.split("\n")) {
    const tokens = parse(line);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const nextToken = tokens[i + 1];

      if (
        token === "git" &&
        typeof nextToken === "string"
      ) {
        subcommands.push(nextToken);
      }
    }
  }

  return subcommands;
}
