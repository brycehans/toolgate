import type { Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs } from "./parse-bash-ast";

const denyBashGrep: Policy = {
  name: "Deny bash grep",
  description: "Rejects grep/egrep/fgrep/rg in Bash — use the built-in Grep tool instead",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return;

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds) return;

    const args = getArgs(cmds[0]);
    if (!args) return;

    const cmd = args[0];
    if (cmd === "grep" || cmd === "egrep" || cmd === "fgrep" || cmd === "rg") {
      return "Do not use `grep` or `rg` in Bash. Use the built-in Grep tool instead — it supports regex, glob filters, and output modes (content, files_with_matches, count).";
    }
  },
};
export default denyBashGrep;
