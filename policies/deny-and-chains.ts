import type { Policy } from "../src";
import {
  parseShell,
  Op,
  type Stmt,
  type BinaryCmd,
  type CallExpr,
  type Lit,
  type SglQuoted,
  type DblQuoted,
} from "./parse-bash-ast";

const ENV_SETTERS = new Set(["eval", "source", ".", "export"]);

const STEERING_MESSAGE = `Each side of \`&&\` becomes its own Bash call. Toolgate evaluates each independently — per-call audit entry, per-call permission cache, per-call policy specificity.

Bad:  mkdir -p tmp && grep ... > tmp/file && wc -l tmp/file
Good: mkdir -p tmp
      grep ... > tmp/file
      wc -l tmp/file

The shell's working directory persists across separate Bash calls in this session, so \`cd <dir>\` in one call carries into the next.

Exempt: chains whose leaves include \`eval\`, \`source\`, \`.\` (dot), or \`export\` — env-setters whose effects must persist into the next leaf and can't survive call decomposition.`;

function collectAndLeaves(bin: BinaryCmd, out: Stmt[]): void {
  const visit = (sideStmt: Stmt) => {
    const c = sideStmt.Cmd;
    if (c && c.Type === "BinaryCmd" && (c as BinaryCmd).Op === Op.And) {
      collectAndLeaves(c as BinaryCmd, out);
    } else {
      out.push(sideStmt);
    }
  };
  visit(bin.X);
  visit(bin.Y);
}

/**
 * Permissive extractor for a leaf's first-word command name. Unlike `getArgs`,
 * this does NOT bail on command-substitution, parameter expansion, or
 * assignments anywhere in the arg list — we only care about the first
 * positional token (the command name). `eval "$(fnm env)"` should still
 * resolve to "eval" even though the second arg contains a CmdSubst.
 */
function firstArg0OfLeaf(leaf: Stmt): string | null {
  const cmd = leaf.Cmd;
  if (!cmd) return null;
  if (cmd.Type === "CallExpr") {
    const args = (cmd as CallExpr).Args;
    if (!args || args.length === 0) return null;
    const parts = args[0].Parts;
    if (!parts || parts.length === 0) return null;
    const p = parts[0];
    if (p.Type === "Lit") return (p as Lit).Value;
    if (p.Type === "SglQuoted") return (p as SglQuoted).Value;
    if (p.Type === "DblQuoted") {
      const d = p as DblQuoted;
      if (d.Parts?.length === 1 && d.Parts[0].Type === "Lit") {
        return (d.Parts[0] as Lit).Value;
      }
    }
    return null;
  }
  // DeclClause covers `export`, `declare`, `local`, `readonly`, `typeset`.
  if (cmd.Type === "DeclClause") {
    return (cmd as any).Variant?.Value ?? null;
  }
  if (cmd.Type === "BinaryCmd") {
    const bin = cmd as BinaryCmd;
    if (bin.Op === Op.Pipe || bin.Op === Op.PipeAll) {
      return firstArg0OfLeaf(bin.X);
    }
  }
  return null;
}

const denyAndChains: Policy = {
  name: "Deny && chains",
  description:
    "Denies `<cmd> && <cmd>` chains so each step is evaluated atomically. Exempts chains whose leaves include env-setters (eval/source/./export) whose effects must persist into subsequent leaves.",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return;

    const stmt = ast.Stmts[0];
    const cmd = stmt.Cmd;
    if (!cmd || cmd.Type !== "BinaryCmd") return;
    const bin = cmd as BinaryCmd;
    if (bin.Op !== Op.And) return;

    const leaves: Stmt[] = [];
    collectAndLeaves(bin, leaves);
    if (leaves.length < 2) return;

    for (const leaf of leaves) {
      const first = firstArg0OfLeaf(leaf);
      if (first && ENV_SETTERS.has(first)) return;
    }

    return STEERING_MESSAGE;
  },
};
export default denyAndChains;
