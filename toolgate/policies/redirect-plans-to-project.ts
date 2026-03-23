import { deny, next, type Policy } from "../../src";
import { parse } from "shell-quote";

const GLOBAL_PLANS_DIR = "/.claude/plans";

/**
 * Deny plan writes to ~/.claude/plans/ and steer Claude to use the project's docs/ folder instead.
 */
const redirectPlansToProject: Policy = {
  name: "Redirect plans to project",
  description: "Blocks plan writes to ~/.claude/plans/ and suggests project docs/ instead",
  handler: async (call) => {
    if (!call.context.projectRoot) {
      return next();
    }

    const projectRoot = call.context.projectRoot;
    const docsDir = `${projectRoot}/docs`;

    if (call.tool === "Write" || call.tool === "Edit") {
      const filePath = call.args.file_path;
      if (typeof filePath !== "string") return next();
      if (isGlobalPlanPath(filePath)) {
        return deny(
          `Plan files should be saved in the project, not globally. Write to ${docsDir}/ instead of ${filePath}`,
        );
      }
      return next();
    }

    if (call.tool === "Bash") {
      const command = call.args.command;
      if (typeof command !== "string") return next();
      const target = findRedirectToGlobalPlans(command);
      if (target) {
        return deny(
          `Plan files should be saved in the project, not globally. Write to ${docsDir}/ instead of ${target}`,
        );
      }
    }

    return next();
  },
};
export default redirectPlansToProject;

function isGlobalPlanPath(filePath: string): boolean {
  // Match any path containing /.claude/plans/
  return filePath.includes(GLOBAL_PLANS_DIR + "/") || filePath.endsWith(GLOBAL_PLANS_DIR);
}

function findRedirectToGlobalPlans(command: string): string | null {
  for (const line of command.split("\n")) {
    const tokens = parse(line);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (
        typeof token === "object" &&
        token !== null &&
        "op" in token &&
        (token.op === ">" || token.op === ">>")
      ) {
        const target = tokens[i + 1];
        if (typeof target === "string" && isGlobalPlanPath(target)) {
          return target;
        }
      }
    }

    // Check tee arguments
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== "tee") continue;
      for (let j = i + 1; j < tokens.length; j++) {
        const arg = tokens[j];
        if (typeof arg !== "string") break;
        if (arg.startsWith("-")) continue;
        if (isGlobalPlanPath(arg)) return arg;
      }
    }
  }

  return null;
}
