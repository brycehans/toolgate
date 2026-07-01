import { join } from "path";
import { homedir } from "os";
import type { Policy } from "../src";

function resolveHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

const USER_SKILLS = join(homedir(), ".claude", "skills");

function isSkillPath(filePath: string, projectRoot?: string): boolean {
  const resolved = resolveHome(filePath);

  // User-level: ~/.claude/skills/
  if (resolved === USER_SKILLS || resolved.startsWith(USER_SKILLS + "/")) {
    return true;
  }

  // Project-level: <projectRoot>/.claude/skills/
  if (projectRoot) {
    const projectSkills = join(projectRoot, ".claude", "skills");
    if (
      resolved === projectSkills ||
      resolved.startsWith(projectSkills + "/")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Allow Read, Write, Edit, and Glob on Claude skill files in
 * ~/.claude/skills/ and <projectRoot>/.claude/skills/.
 */
const allowSkillCrud: Policy = {
  name: "Allow skill CRUD",
  description:
    "Permits Read, Write, Edit, and Glob targeting Claude skill files in ~/.claude/skills/ or .claude/skills/",
  action: "allow",
  handler: async (call) => {
    if (call.tool === "Read" || call.tool === "Write" || call.tool === "Edit") {
      const filePath = call.args.file_path;
      if (typeof filePath !== "string") return;
      if (isSkillPath(filePath, call.context.projectRoot)) return true;
    }

    if (call.tool === "Glob") {
      const path = call.args.path;
      if (typeof path === "string" && isSkillPath(path, call.context.projectRoot)) {
        return true;
      }
    }

    return;
  },
};
export default allowSkillCrud;
