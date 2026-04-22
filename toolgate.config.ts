import { homedir } from "os";
import { definePolicy } from "./src/index";

const CLAUDE_DIR = `${homedir()}/.claude`;

const FILE_TOOLS = new Set(["Read", "Write", "Edit"]);
const PATH_TOOLS = new Set(["Glob", "Grep"]);

function getPath(tool: string, args: Record<string, any>): string | null {
  if (FILE_TOOLS.has(tool)) return typeof args.file_path === "string" ? args.file_path : null;
  if (PATH_TOOLS.has(tool)) return typeof args.path === "string" ? args.path : null;
  return null;
}

export default definePolicy([
  {
    name: "Allow CRUD in ~/.claude",
    description: "Permits Read/Write/Edit/Glob/Grep on paths within ~/.claude",
    action: "allow",
    handler: async (call) => {
      if (!FILE_TOOLS.has(call.tool) && !PATH_TOOLS.has(call.tool)) return;

      const path = getPath(call.tool, call.args);
      if (!path) return;

      if (path === CLAUDE_DIR || path.startsWith(CLAUDE_DIR + "/")) {
        return true;
      }
    },
  },
  {
    name: "Allow claude-code-guide agent",
    description: "Permits the claude-code-guide read-only research agent",
    action: "allow",
    handler: async (call) => {
      if (call.tool !== "Agent") return;
      if (call.args.subagent_type !== "claude-code-guide") return;
      return true;
    },
  },
]);
