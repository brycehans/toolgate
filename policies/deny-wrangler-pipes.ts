import type { Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs } from "./parse-bash-ast";

const WRANGLERS = new Set([
  "jq",
  "fx",
  "yq",
  "xq",
  "htmlq",
  "mlr",
  "miller",
  "jp",
  "jpx",
]);

const STEERING_MESSAGE = `Pipelines like \`<cmd> | jq '<filter>'\` waste the left-hand side when the filter errors out (typo, wrong shape, undefined var). Save once, iterate cheaply:

  Bad:   gh issue view 731 --json title,body | fx '.title + (.body || "")'
  Good:  gh issue view 731 --json title,body > tmp/issue.json
         fx '<filter>' < tmp/issue.json     # iterate without re-running gh

Read the saved file via the canonical form for each wrangler:

  jq '<filter>' tmp/file.json
  fx '<filter>' < tmp/file.json              (fx-as-first-arg has parser traps: leading \`/\` becomes a regex, \`.field\` hits strict-mode)
  yq '<filter>' tmp/file.yaml
  xq -x '<xpath>' tmp/file.xml
  htmlq '<selector>' < tmp/file.html

For ad-hoc exploration, \`gron tmp/file.json | grep <key>\` is often faster than guessing the jq/fx shape — gron flattens to one assignment per line.`;

const denyWranglerPipes: Policy = {
  name: "Deny pipe to data wrangler",
  description:
    "Denies <cmd> | jq/fx/yq/xq/htmlq/mlr <filter> pipelines — points Claude at save-then-iterate so filter errors don't waste the left-hand side",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    if (typeof call.args.command !== "string") return;

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return;

    const segments = getPipelineCommands(ast.Stmts[0]);
    if (!segments || segments.length < 2) return;

    // Segments at index > 0 are pipe-RHS by definition.
    for (let i = 1; i < segments.length; i++) {
      const args = getArgs(segments[i]);
      if (!args || args.length === 0) continue;
      if (!WRANGLERS.has(args[0])) continue;
      // Wrangler with any trailing token (filter or flag) — fire.
      // `cmd | jq` alone (no filter) is legal but vanishingly rare; skip it.
      if (args.length > 1) return STEERING_MESSAGE;
    }
  },
};
export default denyWranglerPipes;
