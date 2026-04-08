import { allow, next, isWithinProject, type Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs, isSafeFilter } from "./parse-bash-ast";

const allowLsInProject: Policy = {
  name: "Allow ls in project",
  description: "Permits ls commands when all paths are within the project root",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();
    if (!call.context.projectRoot) return next();

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return next();

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds || cmds.length === 0) return next();

    const tokens = getArgs(cmds[0]);
    if (!tokens || tokens[0] !== "ls") return next();

    // All subsequent pipeline segments must be safe filters
    for (let i = 1; i < cmds.length; i++) {
      const segArgs = getArgs(cmds[i]);
      if (!segArgs || !isSafeFilter(segArgs)) return next();
    }

    const root = call.context.projectRoot;
    const paths = tokens.slice(1).filter((t) => !t.startsWith("-"));

    if (paths.length === 0) {
      return isWithinProject(call.context.cwd, call.context) ? allow() : next();
    }

    const allInProject = paths.every((p) => {
      // Relative paths are resolved against cwd which is already in-project
      if (p.startsWith("./") || p === "." || !p.startsWith("/")) return true;
      return isWithinProject(p, call.context);
    });

    return allInProject ? allow() : next();
  },
};
export default allowLsInProject;
