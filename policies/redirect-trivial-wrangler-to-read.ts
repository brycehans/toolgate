import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const SMALL_FILE_THRESHOLD = 10 * 1024;
const TRIVIAL_FILTERS = new Set([".", "_"]);
const WRANGLERS = new Set(["jq", "fx", "yq", "gron"]);

const STEERING_MESSAGE = `For files this small (<10KB), use the Read tool instead of a wrangler:
  - No filter syntax to typo
  - Full content lands directly in your context (paginatable)
  - No subprocess fork

Use: Read({ file_path: "<path>" })

Reach for jq/fx/yq/gron only when:
  - The file is too big to context-inject (>~10KB)
  - You need a computed slim (sum/count/group-by/filter) that produces less output than the input
  - You're piping the result to another tool

If you actually want a filtered subset of this small file, use a real filter:
  jq '.users[].name' tmp/file.json     (real filter — keep this)
  jq . tmp/file.json                   (pretty-print only — use Read)`;

function expandHome(path: string): string {
  if (path === "~") return process.env.HOME ?? path;
  if (path.startsWith("~/")) {
    return process.env.HOME ? path.replace(/^~/, process.env.HOME) : path;
  }
  return path;
}

function tryStatSize(cwd: string, path: string): number | null {
  try {
    const expanded = expandHome(path);
    const full = expanded.startsWith("/") ? expanded : resolve(cwd, expanded);
    const stat = statSync(full);
    if (!stat.isFile()) return null;
    return stat.size;
  } catch {
    return null;
  }
}

function getPositionals(rest: string[]): string[] {
  return rest.filter((t) => !t.startsWith("-"));
}

const redirectTrivialWranglerToRead: Policy = {
  name: "Redirect trivial wrangler to Read",
  description:
    "When jq/fx/yq/gron is invoked with a trivial (or no) filter on a small (<10KB) file, steer to the Read tool",
  action: "deny",
  handler: async (call) => {
    const args = await safeBashCommand(call);
    if (!args || args.length === 0) return;

    const wrangler = args[0];
    if (!WRANGLERS.has(wrangler)) return;

    const positionals = getPositionals(args.slice(1));
    if (positionals.length === 0) return;

    // Find one positional that's an existing file; the rest are filter args.
    const cwd = (call.context as any)?.cwd ?? process.cwd();
    let fileSize: number | null = null;
    const nonFileArgs: string[] = [];
    for (const p of positionals) {
      if (fileSize === null) {
        const size = tryStatSize(cwd, p);
        if (size !== null) {
          fileSize = size;
          continue;
        }
      }
      nonFileArgs.push(p);
    }

    if (fileSize === null) return;
    if (fileSize >= SMALL_FILE_THRESHOLD) return;

    // gron has no filter syntax — always trivial.
    if (wrangler === "gron") return STEERING_MESSAGE;

    // No filter args (e.g. `jq file.json`) → defaults to identity → trivial.
    if (nonFileArgs.length === 0) return STEERING_MESSAGE;

    // Single trivial filter token (".", "_") → trivial.
    if (nonFileArgs.length === 1 && TRIVIAL_FILTERS.has(nonFileArgs[0])) {
      return STEERING_MESSAGE;
    }
  },
};
export default redirectTrivialWranglerToRead;
