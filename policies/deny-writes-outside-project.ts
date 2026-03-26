import { homedir } from "os";
import { resolve } from "path";
import { allow, deny, next, type Policy } from "../src";
import { parseShell, findWriteRedirects, findTeeTargets, getRedirects, Op, wordToString } from "./parse-bash-ast";

const SAFE_WRITE_TARGETS = new Set(["/dev/null", "/dev/stderr", "/dev/stdout"]);

const denyWritesOutsideProject: Policy = {
  name: "Deny writes outside project",
  description: "Blocks file writes and Bash redirects targeting paths outside the project root",
  handler: async (call) => {
    if (!call.context.projectRoot) return next();
    const projectRoot = call.context.projectRoot;

    if (call.tool === "Write" || call.tool === "Edit") {
      const filePath = call.args.file_path;
      if (typeof filePath !== "string") return next();
      if (!isInsideProject(filePath, projectRoot)) {
        return deny(`Write blocked: ${filePath} is outside project root (${projectRoot})`);
      }
      return next();
    }

    if (call.tool === "Bash") {
      const command = call.args.command;
      if (typeof command !== "string") return next();

      const ast = await parseShell(command);
      if (!ast) return next();

      const cwd = call.context.cwd;

      // Check write redirects (> and >>), already filtered to exclude safe targets
      const writeRedirects = findWriteRedirects(ast);
      for (const r of writeRedirects) {
        if (!r.target) continue;
        const resolved = resolvePath(r.target, cwd);
        if (resolved && !isInsideProject(resolved, projectRoot)) {
          return deny(`Write blocked: redirect target is outside project root (${projectRoot})`);
        }
      }

      // Check tee targets
      const teeTargets = findTeeTargets(ast);
      for (const target of teeTargets) {
        if (SAFE_WRITE_TARGETS.has(target)) continue;
        const resolved = resolvePath(target, cwd);
        if (resolved && !isInsideProject(resolved, projectRoot)) {
          return deny(`Write blocked: redirect target is outside project root (${projectRoot})`);
        }
      }

      // If there are any safe-only redirects (all unsafe ones would have returned deny above),
      // return allow() so the command doesn't get prompted
      const allRedirs = getRedirects(ast);
      const hasSafeWriteRedirect = allRedirs.some(
        (r) => (r.op === Op.RdrOut || r.op === Op.AppOut) && r.target && SAFE_WRITE_TARGETS.has(r.target),
      );
      const hasSafeTee = teeTargets.some((t) => SAFE_WRITE_TARGETS.has(t));

      if (hasSafeWriteRedirect || hasSafeTee) {
        return allow();
      }
    }

    return next();
  },
};
export default denyWritesOutsideProject;

function isInsideProject(filePath: string, projectRoot: string): boolean {
  return SAFE_WRITE_TARGETS.has(filePath) || filePath === projectRoot || filePath.startsWith(projectRoot + "/");
}

function resolvePath(p: string, cwd: string): string | null {
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (p === "~") return homedir();
  if (p.startsWith("/")) return p;
  if (!p.startsWith("-")) return resolve(cwd, p);
  return null;
}
