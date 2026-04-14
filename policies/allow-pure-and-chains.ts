import { allow, next, type Policy } from "../src";
import {
  parseShell,
  hasUnsafeNodes,
  getArgs,
  getAndChainSegments,
  isPureCommand,
} from "./parse-bash-ast";

/**
 * Allow && chains where EVERY segment is a provably side-effect-free command.
 *
 * Safety guarantee (layered):
 * 1. AST parser (shfmt) — correct tokenization, no string-split bugs
 * 2. getAndChainSegments — rejects redirections, $(), $VAR, assignments, ||, pipes
 * 3. isPureCommand — only side-effect-free commands in strict allowlist
 *
 * Since no segment can modify shell state (cwd, env, filesystem), each
 * segment runs as if in isolation. Pure functions compose safely.
 */
const allowPureAndChains: Policy = {
  name: "Allow pure command chains",
  description:
    "Permits && chains where every segment is a side-effect-free command (php -l, echo, test)",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    const command = call.args?.command;
    if (typeof command !== "string") return next();

    const file = await parseShell(command);
    if (!file) return next();
    if (hasUnsafeNodes(file)) return next();

    const segments = getAndChainSegments(file);
    if (!segments) return next();

    for (const segment of segments) {
      const args = getArgs(segment);
      if (!args) return next();
      if (!isPureCommand(args)) return next();
    }

    return allow();
  },
};
export default allowPureAndChains;
