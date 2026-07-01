import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const HOME = homedir();
const PROJECTS_DIR = join(HOME, ".claude", "projects");

function resolveHome(p: string): string {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return HOME + p.slice(1);
  return p;
}

/**
 * Memory lives at ~/.claude/projects/<encoded-project>/memory/<file>.
 * Files are flat (no nested subdirs) and are owned by Claude — the agent
 * authors and curates them itself.
 */
function isMemoryPath(path: string): boolean {
  const expanded = resolveHome(path);
  if (!expanded.startsWith(PROJECTS_DIR + "/")) return false;
  const rel = expanded.slice(PROJECTS_DIR.length + 1);
  return /^[^/]+\/memory\/[^/]+/.test(rel);
}

/** Matches the memory dir itself or any file/path within it (with or without trailing slash). */
function isMemoryDirOrChild(path: string): boolean {
  const expanded = resolveHome(path).replace(/\/+$/, "");
  if (!expanded.startsWith(PROJECTS_DIR + "/")) return false;
  const rel = expanded.slice(PROJECTS_DIR.length + 1);
  return /^[^/]+\/memory(\/.+)?$/.test(rel);
}

/**
 * Allow Claude full CRUD on its own auto-memory files
 * (~/.claude/projects/*\/memory/<file>):
 *   - Read / Write / Edit / Update via the dedicated tools
 *   - `rm <single-file>` via Bash, no -r/-f (memory is a flat directory)
 *   - `ls` of the memory dir or files within it
 */
const allowMemoryCrud: Policy = {
  name: "Allow CRUD on Claude memory",
  description:
    "Permits Read/Write/Edit on files under ~/.claude/projects/*/memory/, plus rm/ls of memory files via Bash",
  action: "allow",
  handler: async (call) => {
    if (call.tool === "Read" || call.tool === "Write" || call.tool === "Edit" || call.tool === "Update") {
      const filePath = call.args.file_path;
      if (typeof filePath !== "string") return;
      return isMemoryPath(filePath) ? true : undefined;
    }

    if (call.tool === "Bash") {
      const args = await safeBashCommand(call);
      if (!args) return;

      if (args[0] === "rm") {
        const flags = args.slice(1).filter((t) => t.startsWith("-"));
        const paths = args.slice(1).filter((t) => !t.startsWith("-"));
        if (paths.length === 0) return;

        if (flags.some((f) => /[rfR]/.test(f))) return;

        const allInMemory = paths.every((p) => {
          const resolved = resolve(call.context.cwd, resolveHome(p));
          return isMemoryPath(resolved);
        });
        return allInMemory ? true : undefined;
      }

      if (args[0] === "ls") {
        const paths = args.slice(1).filter((t) => !t.startsWith("-"));
        if (paths.length === 0) return;

        const allInMemory = paths.every((p) => {
          const resolved = resolve(call.context.cwd, resolveHome(p));
          return isMemoryDirOrChild(resolved);
        });
        return allInMemory ? true : undefined;
      }

      return;
    }

    return;
  },
};
export default allowMemoryCrud;
