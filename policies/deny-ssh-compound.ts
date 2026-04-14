import { deny, next, type Policy } from "../src";
import { parseShell, Op } from "./parse-bash-ast";

/**
 * Require approval for compound commands that include ssh.
 * ssh in a chain (&&, ||, ;) could hide dangerous follow-ups.
 * A standalone `ssh ...` or `ssh ... | grep` is fine — just compounds are flagged.
 */
const denySshCompound: Policy = {
  name: "Deny ssh in compound commands",
  description:
    "Rejects compound Bash commands (&&, ||, ;) that contain ssh — run ssh separately for explicit approval",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    const cmd = call.args.command;
    if (typeof cmd !== "string") return next();
    if (!cmd.includes("ssh")) return next();

    const ast = await parseShell(cmd);
    if (!ast) return next();

    // Multiple statements means ; chaining
    if (ast.Stmts.length > 1) {
      const hasSsh = ast.Stmts.some((stmt) => containsSsh(stmt.Cmd));
      if (hasSsh) {
        return deny(
          "Don't chain commands with ssh. Run ssh as its own Bash call for explicit approval.",
        );
      }
    }

    // Single statement with BinaryCmd (&&, ||)
    if (ast.Stmts.length === 1 && ast.Stmts[0].Cmd?.Type === "BinaryCmd") {
      if (containsSshBinary(ast.Stmts[0].Cmd)) {
        return deny(
          "Don't chain commands with ssh. Run ssh as its own Bash call for explicit approval.",
        );
      }
    }

    return next();
  },
};

function containsSsh(cmd: any): boolean {
  if (!cmd) return false;
  if (cmd.Type === "CallExpr") {
    const firstArg = cmd.Args?.[0]?.Parts?.[0];
    return firstArg?.Type === "Lit" && firstArg.Value === "ssh";
  }
  return false;
}

function containsSshBinary(cmd: any): boolean {
  if (!cmd) return false;
  if (cmd.Type === "CallExpr") {
    const firstArg = cmd.Args?.[0]?.Parts?.[0];
    return firstArg?.Type === "Lit" && firstArg.Value === "ssh";
  }
  if (cmd.Type === "BinaryCmd") {
    // Pipes are fine — single logical operation
    if (cmd.Op === Op.Pipe || cmd.Op === Op.PipeAll) return false;
    return containsSshBinary(cmd.X?.Cmd) || containsSshBinary(cmd.Y?.Cmd);
  }
  return false;
}

export default denySshCompound;
