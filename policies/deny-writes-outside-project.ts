import { homedir } from "os";
import { resolve } from "path";
import { isWithinProject, type Policy } from "../src";
import { parseShell, findWriteRedirects, findTeeTargets, findWriteCommandTargets, getRedirects, Op, wordToString } from "./parse-bash-ast";

const SAFE_WRITE_TARGETS = new Set(["/dev/null", "/dev/stderr", "/dev/stdout"]);

const denyWritesOutsideProject: Policy = {
  name: "Deny writes outside project",
  description: "Blocks file writes and Bash redirects targeting paths outside the project root",
  action: "deny",
  handler: async (call) => {
    if (!call.context.projectRoot) return;
    const projectRoot = call.context.projectRoot;

    if (call.tool === "Write" || call.tool === "Edit") {
      const filePath = call.args.file_path;
      if (typeof filePath !== "string") return;
      if (!isInsideProject(filePath, call.context)) {
        return `Write blocked: ${filePath} is outside project root (${projectRoot})`;
      }
      return;
    }

    if (call.tool === "Bash") {
      const command = call.args.command;
      if (typeof command !== "string") return;

      const ast = await parseShell(command);
      if (!ast) return;

      const cwd = call.context.cwd;

      // Check write redirects (> and >>), already filtered to exclude safe targets
      const writeRedirects = findWriteRedirects(ast);
      for (const r of writeRedirects) {
        if (!r.target) continue;
        const resolved = resolvePath(r.target, cwd);
        if (resolved && !isInsideProject(resolved, call.context)) {
          return `Write blocked: redirect target is outside project root (${projectRoot})`;
        }
      }

      // Check tee targets
      const teeTargets = findTeeTargets(ast);
      for (const target of teeTargets) {
        if (SAFE_WRITE_TARGETS.has(target)) continue;
        const resolved = resolvePath(target, cwd);
        if (resolved && !isInsideProject(resolved, call.context)) {
          return `Write blocked: redirect target is outside project root (${projectRoot})`;
        }
      }

      // Check write command destinations (cp, mv, install)
      const writeTargets = findWriteCommandTargets(ast);
      for (const target of writeTargets) {
        const resolved = resolvePath(target, cwd);
        if (resolved && !isInsideProject(resolved, call.context)) {
          return `Write blocked: "${target}" is outside project root. Use ./tmp/ within your project instead.`;
        }
      }
    }
  },
};
export default denyWritesOutsideProject;

function isInsideProject(filePath: string, context: { projectRoot: string; additionalDirs: string[] }): boolean {
  return SAFE_WRITE_TARGETS.has(filePath) || isWithinProject(filePath, context);
}

function resolvePath(p: string, cwd: string): string | null {
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (p === "~") return homedir();
  if (p.startsWith("/")) return p;
  if (!p.startsWith("-")) return resolve(cwd, p);
  return null;
}
