import { homedir } from "node:os";
import { resolve } from "node:path";

const HOME = homedir();

/**
 * Expand a leading `~`/`~/` or `$HOME`/`${HOME}` to the real home directory.
 * Without this, a token like `~/.aws/credentials` is treated as a literal
 * relative path and `resolve(cwd, "~/.aws/credentials")` lands *inside* the
 * project — so the containment check wrongly passes while the shell would
 * expand `~` to $HOME at runtime and read the real file.
 */
export function resolveHome(p: string): string {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return HOME + p.slice(1);
  if (p === "$HOME" || p === "${HOME}") return HOME;
  if (p.startsWith("$HOME/")) return HOME + p.slice(5);
  if (p.startsWith("${HOME}/")) return HOME + p.slice(7);
  return p;
}

/**
 * Dot-prefixed trees that hold working material rather than secrets, so the
 * dot-segment check below skips them. Machine-specific by nature — these are
 * the dot-paths this user actually reads, not a portable default.
 */
const SAFE_DOT_PATHS = [
  "~/.bun/install/global/node_modules",
  "~/.claude",
  "~/Dev/brain/.system",
].map(resolveHome);

function hasDotSegment(path: string): boolean {
  for (const seg of path.split("/")) {
    if (seg === "" || seg === "." || seg === "..") continue;
    if (seg.startsWith(".")) return true;
  }
  return false;
}

/**
 * Whether a path reaches into dot-prefixed territory that hasn't been declared
 * safe. Dot-prefixed dirs (`~/.ssh`, `.aws`, `.gnupg`, `.env` siblings) tend to
 * hold secrets or tooling state the user hasn't opted into sharing.
 *
 * Dot segments are counted on the path as written, so a bare `ls foo` stays
 * allowed inside a dot-directory; the allowlist is matched against the resolved
 * path, so `~/Dev/.claude` can't pass itself off as `~/.claude`.
 */
export function hasUnsafeDotSegment(path: string, cwd: string): boolean {
  const expanded = resolveHome(path);
  if (!hasDotSegment(expanded)) return false;

  const resolved = resolve(cwd, expanded);
  return !SAFE_DOT_PATHS.some((safe) => resolved === safe || resolved.startsWith(safe + "/"));
}
