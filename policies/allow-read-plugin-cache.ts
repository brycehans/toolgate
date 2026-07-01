import { join } from "path";
import { homedir } from "os";
import type { Policy } from "../src";

function resolveHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

const PLUGIN_CACHE = join(homedir(), ".claude", "plugins", "cache");

/**
 * Allow reading files from Claude's plugin cache directory (~/.claude/plugins/cache/).
 */
const allowReadPluginCache: Policy = {
  name: "Allow read plugin cache",
  description:
    "Permits Read tool calls targeting files within ~/.claude/plugins/cache/",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Read") return;

    const filePath = call.args.file_path;
    if (typeof filePath !== "string") return;

    const resolved = resolveHome(filePath);
    if (
      resolved === PLUGIN_CACHE ||
      resolved.startsWith(PLUGIN_CACHE + "/")
    ) {
      return true;
    }

    return;
  },
};
export default allowReadPluginCache;
