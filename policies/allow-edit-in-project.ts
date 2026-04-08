import { basename } from "path";
import { homedir } from "os";
import { allow, next, isWithinProject, type Policy } from "../src";

function resolveHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

// Files where edits have side effects beyond the file content itself.
// These fall through to prompt the user instead of auto-allowing.
const SENSITIVE_PATTERNS: Array<{ match: (rel: string) => boolean; reason: string }> = [
  // Secrets — may contain API keys, passwords, or certificates
  { match: (rel) => /^\.env($|\.)/.test(basename(rel)), reason: "environment secrets" },
  { match: (rel) => /\.(pem|key|p12)$/.test(rel), reason: "cryptographic key material" },
  { match: (rel) => basename(rel) === "credentials.json", reason: "service credentials" },
  { match: (rel) => basename(rel).startsWith("secrets."), reason: "secrets file" },

  // Config that executes code — scripts run on install, build, or test
  { match: (rel) => basename(rel) === "package.json", reason: "scripts section can run arbitrary code" },

  // CI/CD — changes deploy to production or run in privileged environments
  { match: (rel) => rel.startsWith(".github/workflows/"), reason: "CI/CD pipeline runs with elevated permissions" },
  { match: (rel) => basename(rel) === ".gitlab-ci.yml", reason: "CI/CD pipeline runs with elevated permissions" },

  // Git hooks — execute automatically on git operations
  { match: (rel) => rel.startsWith(".git/hooks/"), reason: "executes automatically on git operations" },
  { match: (rel) => rel.startsWith(".husky/"), reason: "executes automatically on git operations" },

  // Permission/policy config — edits can weaken security boundaries
  { match: (rel) => rel.startsWith(".claude/settings"), reason: "controls Claude Code permissions" },
  { match: (rel) => basename(rel) === "toolgate.config.ts", reason: "controls toolgate policy evaluation" },
];

function isSensitive(filePath: string, context: { projectRoot: string; additionalDirs: string[] }): boolean {
  const dirs = [context.projectRoot, ...(context.additionalDirs ?? [])];
  for (const dir of dirs) {
    if (filePath === dir || filePath.startsWith(dir + "/")) {
      const rel = filePath.slice(dir.length + 1);
      return SENSITIVE_PATTERNS.some(({ match }) => match(rel));
    }
  }
  return false;
}

const allowEditInProject: Policy = {
  name: "Allow edits in project",
  description: "Auto-allows Edit, Write, and Update tool calls targeting files inside the project root, except sensitive files",
  handler: async (call) => {
    if (call.tool !== "Edit" && call.tool !== "Write" && call.tool !== "Update") return next();

    const filePath = call.args.file_path;
    if (typeof filePath !== "string") return next();

    const projectRoot = call.context.projectRoot;
    if (!projectRoot) return next();

    const resolved = resolveHome(filePath);
    if (isWithinProject(resolved, call.context)) {
      if (isSensitive(resolved, call.context)) return next();
      return allow();
    }

    return next();
  },
};
export default allowEditInProject;
