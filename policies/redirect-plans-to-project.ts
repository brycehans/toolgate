import type { Policy } from "../src";
import { parseShell, getRedirects, findTeeTargets, Op } from "./parse-bash-ast";

const GLOBAL_PLANS_DIR = "/.claude/plans";

const redirectPlansToProject: Policy = {
  name: "Redirect plans to project",
  description: "Blocks plan writes to ~/.claude/plans/ and suggests project docs/ instead",
  action: "deny",
  handler: async (call) => {
    if (!call.context.projectRoot) return;
    const projectRoot = call.context.projectRoot;
    const docsDir = `${projectRoot}/docs`;

    if (call.tool === "Write" || call.tool === "Edit") {
      const filePath = call.args.file_path;
      if (typeof filePath !== "string") return;
      if (isGlobalPlanPath(filePath)) {
        return `Plan files should be saved in the project, not globally. Write to ${docsDir}/ instead of ${filePath}`;
      }
      return;
    }

    if (call.tool === "Bash") {
      const command = call.args.command;
      if (typeof command !== "string") return;

      const ast = await parseShell(command);
      if (!ast) return;

      // Check write redirects
      const allRedirs = getRedirects(ast);
      for (const r of allRedirs) {
        if (r.op !== Op.RdrOut && r.op !== Op.AppOut) continue;
        if (r.target && isGlobalPlanPath(r.target)) {
          return `Plan files should be saved in the project, not globally. Write to ${docsDir}/ instead of ${r.target}`;
        }
      }

      // Check tee targets
      const teeTargets = findTeeTargets(ast);
      for (const target of teeTargets) {
        if (isGlobalPlanPath(target)) {
          return `Plan files should be saved in the project, not globally. Write to ${docsDir}/ instead of ${target}`;
        }
      }
    }
  },
};
export default redirectPlansToProject;

function isGlobalPlanPath(filePath: string): boolean {
  return filePath.includes(GLOBAL_PLANS_DIR + "/") || filePath.endsWith(GLOBAL_PLANS_DIR);
}
