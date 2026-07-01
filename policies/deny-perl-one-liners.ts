import type { Policy } from "../src";
import { parseShell, getAllLeafCommands, getArgs } from "./parse-bash-ast";

const STEERING_MESSAGE = `Perl one-liners (perl -e/-ne/-pe/-E/-ple etc.) execute arbitrary code and can't be auto-allowed. For text wrangling, use these safe-by-design tools (auto-allowed as mid-pipeline filters):

  Multi-capture regex extraction:  rg -oP '<pattern>' --replace '$1|$2|$3'
  Range between markers:           sed -n '/START/,/END/p'
  Column selection:                cut -d: -f1   or   choose 0 2
  Find/replace on stdin:           sd '<find>' '<replace>'
  HTML query (CSS selectors):      htmlq '<selector>'
  XML query (XPath):               xq -x '<xpath>'
  JSON query:                      jq '<filter>'   (or fx, gron)

If perl is genuinely required, save the script to scripts/<name>.pl and call it as ./scripts/<name>.pl — that file is then git-auditable.`;

/**
 * Detect perl flags that introduce an inline script:
 *   -e            execute
 *   -E            execute with extended features
 *   -ne / -pe     -e combined with -n / -p (implicit loop)
 *   -ane / -nle / -ple / -pae etc.
 *
 * Matches: lowercase short-flag combos containing 'e', OR exactly -E.
 * Skips: -Mmodule, -I/path, -D, --version, etc.
 */
const PERL_INLINE_FLAG = /^(-[a-z]*e[a-z]*|-E)$/;

const denyPerlOneLiners: Policy = {
  name: "Deny perl one-liners with steering",
  description:
    "Denies inline perl scripts (perl -e/-ne/-pe/etc.) and points Claude at safer alternatives (rg --replace, sd, choose, sed, htmlq, xq)",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast) return;

    const leaves = getAllLeafCommands(ast);
    if (!leaves) return;

    for (const stmt of leaves) {
      const args = getArgs(stmt);
      if (!args || args.length === 0) continue;
      if (args[0] !== "perl") continue;
      for (const t of args.slice(1)) {
        if (PERL_INLINE_FLAG.test(t)) return STEERING_MESSAGE;
      }
    }
  },
};
export default denyPerlOneLiners;
