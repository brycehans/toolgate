import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { isWithinProject, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";
import { resolveHome } from "./safe-dot-paths";
import { READ_ONLY_GIT, isUnsafeUse } from "./allow-non-destructive-git";

/**
 * The only global git options this policy will skip past. `allow-non-destructive-git`
 * fails closed on *any* leading flag because `-c`/`--exec-path` can run arbitrary
 * commands. These two only redirect which repo is touched, so they can be allowed
 * once the redirected path is itself checked.
 */
const REPO_REDIRECT_FLAGS = new Set(["--git-dir", "--work-tree"]);

/**
 * Follow symlinks so `--git-dir=./link` can't name an in-scope path that
 * points outside it. A path that doesn't exist yet has no link to follow, and
 * git will fail on it anyway, so the lexical resolution stands in.
 */
function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

interface Stripped {
  rest: string[];
  consumed: boolean;
}

/**
 * Consumes a leading run of `--git-dir=`/`--work-tree=` (or space-separated)
 * flags, provided every path they name resolves within the project root or an
 * additionalDirs entry. Returns null on an unrecognized global option, a
 * flag with no value, or a path outside that scope — the caller should then
 * leave the call alone rather than guess.
 */
function stripRepoRedirectFlags(
  tokens: string[],
  cwd: string,
  context: { projectRoot: string; additionalDirs: string[] },
): Stripped | null {
  const rest = tokens.slice(1);
  let consumed = false;
  // Compare real paths on both sides: resolving only the target would refuse
  // legitimate paths whenever the project root itself sits under a symlink
  // (macOS /var -> /private/var, a symlinked ~/Dev).
  const scope = {
    projectRoot: realOrResolved(context.projectRoot),
    additionalDirs: context.additionalDirs.map(realOrResolved),
  };

  while (rest.length > 0 && rest[0].startsWith("-")) {
    const tok = rest[0];
    const eq = tok.indexOf("=");
    const flag = eq === -1 ? tok : tok.slice(0, eq);
    if (!REPO_REDIRECT_FLAGS.has(flag)) return null;

    let value: string;
    if (eq !== -1) {
      value = tok.slice(eq + 1);
      rest.shift();
    } else {
      if (rest.length < 2) return null;
      value = rest[1];
      rest.splice(0, 2);
    }

    if (!isWithinProject(realOrResolved(resolve(cwd, resolveHome(value))), scope)) return null;
    consumed = true;
  }

  return { rest, consumed };
}

const allowGitDirFlag: Policy = {
  name: "Allow git --git-dir/--work-tree within project scope",
  description:
    "Permits `git --git-dir=<path>`/`--work-tree=<path>` (and the space-separated forms) when every redirected path resolves within the project root or an additionalDirectories entry, and the subcommand past the flag is on the same read-only allowlist as allow-non-destructive-git. Lets read-only inspection of a sibling checkout (e.g. `git --git-dir=../other-repo/.git grep ...`) through without opening up arbitrary repo redirection.",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] !== "git") return;
    if (!call.context.projectRoot) return;

    const stripped = stripRepoRedirectFlags(tokens, call.context.cwd, call.context);
    if (!stripped || !stripped.consumed) return;

    const sub = stripped.rest[0];
    if (!sub || sub.startsWith("-")) return;
    if (!READ_ONLY_GIT.has(sub)) return;
    if (isUnsafeUse(sub, stripped.rest.slice(1))) return;

    return true;
  },
};
export default allowGitDirFlag;
