import { deny, next, type Policy } from "../src";
import { parseShell, findGitSubcommands } from "./parse-bash-ast";

const denyGitAddAndCommit: Policy = {
  name: "Deny git add-and-commit",
  description: "Blocks compound git add+commit commands, forcing separate steps",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();

    const ast = await parseShell(call.args.command);
    if (!ast) return next();

    const subcommands = findGitSubcommands(ast);
    if (subcommands.includes("add") && subcommands.includes("commit")) {
      return deny("Split git add and git commit into separate steps");
    }

    return next();
  },
};
export default denyGitAddAndCommit;
