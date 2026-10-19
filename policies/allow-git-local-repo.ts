import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

/** Cache remote check results per projectRoot for the process lifetime. */
const remoteCache = new Map<string, boolean>();

async function isLocalRepo(projectRoot: string): Promise<boolean> {
  const cached = remoteCache.get(projectRoot);
  if (cached !== undefined) return cached;

  try {
    const proc = Bun.spawn(["git", "remote"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    // A directory that is not a repo at all fails on stderr with an empty
    // stdout — indistinguishable from a repo with no remotes unless the exit
    // code is checked, and treating it as local blanket-allows git there.
    const local = exitCode === 0 && output.trim() === "";
    remoteCache.set(projectRoot, local);
    return local;
  } catch {
    return false;
  }
}

/**
 * Patterns that discard uncommitted work — these should still prompt
 * the user even in local repos.
 */
function isDestructiveGit(tokens: string[]): boolean {
  const sub = tokens[1];
  const rest = tokens.slice(2);

  if (sub === "reset" && rest.includes("--hard")) return true;

  if (sub === "checkout") {
    // `git checkout .` or `git checkout -- .`
    if (rest.includes(".")) return true;
  }

  if (sub === "restore") {
    // `git restore --staged` is safe; bare `git restore` discards working tree changes
    if (!rest.includes("--staged")) return true;
  }

  if (sub === "clean") {
    if (rest.some((t) => t.includes("f") && t.startsWith("-"))) return true;
  }

  if (sub === "stash") {
    if (rest.includes("drop") || rest.includes("clear")) return true;
  }

  if (sub === "branch") {
    if (rest.includes("-D")) return true;
  }

  return false;
}

const allowGitLocalRepo: Policy = {
  name: "Allow git in local repos",
  description:
    "Auto-approves git operations in repos with no configured remotes, except commands that discard uncommitted work",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return;
    if (tokens[0] !== "git") return;

    // `isDestructiveGit` reads tokens[1] as the subcommand, which a git global
    // option would displace — see allow-non-destructive-git for why this fails
    // closed instead of skipping past the flag.
    if (!tokens[1] || tokens[1].startsWith("-")) return;

    const projectRoot = call.context.projectRoot;
    if (!projectRoot) return;

    if (!(await isLocalRepo(projectRoot))) return;

    if (isDestructiveGit(tokens)) return;

    return true;
  },
};
export default allowGitLocalRepo;
