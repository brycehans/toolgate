import { join } from "path";
import { homedir } from "os";
import type { Policy } from "../src";

function resolveHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Allow reading files from Claude's persisted tool-results directory
 * (~/.claude/projects/.../tool-results/).
 */
const allowReadToolResults: Policy = {
  name: "Allow read tool results",
  description:
    "Permits Read tool calls targeting files within ~/.claude/projects/*/tool-results/",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "Read") return;

    const filePath = call.args.file_path;
    if (typeof filePath !== "string") return;

    const resolved = resolveHome(filePath);
    if (!resolved.startsWith(PROJECTS_DIR + "/")) return;

    // Only allow reading within tool-results/ subdirectories
    const relative = resolved.slice(PROJECTS_DIR.length + 1);
    if (/^[^/]+\/[^/]+\/tool-results\//.test(relative)) return true;

    return;
  },
};
export default allowReadToolResults;
