import type { Policy } from "../src";
import { classifyFindXargs } from "./allow-find-xargs-read";

/**
 * Steer `find ... | xargs <read-only cmd>` to its NUL-delimited form.
 *
 * Fires only when the pipeline is exactly what "Allow find -print0 | xargs -0
 * read" permits except for the delimiting, so following the message always
 * lands on an auto-allowed command. Every other find/xargs shape is left to
 * prompt as before.
 */
const denyFindXargsWithoutNull: Policy = {
  name: "Deny find | xargs without -print0/-0",
  description:
    "Rejects `find | xargs <read-only cmd>` without NUL delimiting, where a file name containing a space can split into an extra operand, and suggests the -print0 / -0 form",
  action: "deny",
  handler: async (call) => {
    const verdict = await classifyFindXargs(call);
    if (verdict?.kind !== "needs-null") return;

    return `Without NUL delimiting, xargs splits file names on spaces and quotes, so a name like \`x /etc/passwd\` becomes two operands — which is why this always prompts. Add \`-print0\` to find and \`-0\` to xargs; that form is auto-allowed:

  ${verdict.suggestion}

For a plain content search, the Grep tool needs no shell at all.`;
  },
};
export default denyFindXargsWithoutNull;
