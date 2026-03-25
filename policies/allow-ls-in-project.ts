import { allow, next, type Policy } from "../src";
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
      if (call.context.cwd.startsWith(root + "/") || call.context.cwd === root) {
        return allow();
      }
      return next();
    }

    const allInProject = paths.every(
      (p) => p.startsWith(root + "/") || p === root || p.startsWith("./") || p === "." || !p.startsWith("/"),
    );

    return allInProject ? allow() : next();
  },
};
export default allowLsInProject;
