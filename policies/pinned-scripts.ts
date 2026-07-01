import { resolve } from "node:path";
import type { Policy } from "../src";
import { fileMatchesHash } from "../src/pin";
import { parseShell, getAllLeafCommands, getArgs } from "./parse-bash-ast";

/**
 * Interpreters whose first positional argument is the script they execute.
 * (`node query.mjs`, `python foo.py`, `bash deploy.sh`, …)
 */
const INTERPRETERS = new Set([
  "node",
  "bun",
  "deno",
  "python",
  "python3",
  "ruby",
  "php",
  "sh",
  "bash",
  "zsh",
  "tsx",
  "ts-node",
]);

function basename(cmd: string): string {
  const i = cmd.lastIndexOf("/");
  return i === -1 ? cmd : cmd.slice(i + 1);
}

/**
 * Given a leaf command's argv, return the path of the local script it
 * *executes* (as written), or `null` if it executes none.
 *
 *   node query.mjs          → "query.mjs"
 *   bun ./scripts/x.ts      → "./scripts/x.ts"
 *   /usr/bin/python foo.py  → "foo.py"
 *   ./deploy.sh             → "./deploy.sh"
 *   grep query.mjs          → null   (mentions it as data, doesn't run it)
 *
 * Only the first non-flag positional after an interpreter is the script; later
 * tokens are the script's own arguments. This intentionally ignores bare
 * PATH-resolved commands (no `/`) so we never confuse a normal utility for a
 * pinned file.
 */
export function executedScriptArg(args: string[]): string | null {
  if (args.length === 0) return null;
  const cmd = args[0];

  if (INTERPRETERS.has(basename(cmd))) {
    for (let i = 1; i < args.length; i++) {
      if (!args[i].startsWith("-")) return args[i];
    }
    return null;
  }

  // Direct execution of a path: ./foo, ../foo, /abs/foo, dir/foo
  if (cmd.includes("/")) return cmd;

  return null;
}

/**
 * Build a deny policy that pins whitelisted scripts to their audited contents.
 *
 * `pins` maps a script path (relative to the project root, or absolute) to its
 * expected SHA-256 — record each with `toolgate hash <file>`. On every Bash
 * call, any *executed* pinned script whose on-disk contents no longer match its
 * pin is denied with a re-audit hint.
 *
 * Because the engine always runs deny policies before allow policies, this
 * composes with existing allow rules without modifying them: matching scripts
 * still auto-approve; drifted ones are blocked first.
 *
 *   import { pinnedScripts } from "@brycehanscomb/toolgate"
 *
 *   export default definePolicy([
 *     pinnedScripts({
 *       "query.mjs": "…",
 *       "db.mjs":    "…",
 *     }),
 *     // …existing allow policies, unchanged…
 *   ])
 */
export function pinnedScripts(pins: Record<string, string>): Policy {
  return {
    name: "Pinned scripts unchanged",
    description:
      "Deny running a whitelisted script whose contents have drifted from their recorded SHA-256 pin",
    action: "deny",
    handler: async (call) => {
      if (call.tool !== "Bash") return;
      const command = call.args?.command;
      if (typeof command !== "string") return;

      const file = await parseShell(command);
      if (!file) return; // unparseable → let downstream policies / the prompt handle it

      const leaves = getAllLeafCommands(file);
      if (!leaves) return;

      const { cwd, projectRoot } = call.context;

      // Resolve each pin key to an absolute path (relative to the project root).
      const expectedByAbs = new Map<string, string>();
      for (const [key, hash] of Object.entries(pins)) {
        expectedByAbs.set(resolve(projectRoot, key), hash);
      }

      for (const leaf of leaves) {
        const args = getArgs(leaf);
        if (!args) continue;
        const scriptArg = executedScriptArg(args);
        if (!scriptArg) continue;

        const scriptAbs = resolve(cwd, scriptArg);
        const expected = expectedByAbs.get(scriptAbs);
        if (!expected) continue; // not a pinned script

        if (!(await fileMatchesHash(scriptAbs, expected))) {
          return (
            `${scriptArg} no longer matches its pinned SHA-256 (changed or missing) — ` +
            `it must be re-audited before it can run. ` +
            `After reviewing it, update the pin with: toolgate hash ${scriptArg}`
          );
        }
      }

      return; // no pinned script drifted
    },
  };
}
