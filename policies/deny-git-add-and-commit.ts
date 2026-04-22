import type { Policy } from "../src";
import { parseShell, findGitSubcommands } from "./parse-bash-ast";

const denyGitAddAndCommit: Policy = {
  name: "Deny git add-and-commit",
  description: "Blocks compound git add+commit commands, forcing separate steps",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast) return;

    const subcommands = findGitSubcommands(ast);
    if (subcommands.includes("add") && subcommands.includes("commit")) {
      return "Split git add and git commit into separate steps";
    }
  },
};
export default denyGitAddAndCommit;
