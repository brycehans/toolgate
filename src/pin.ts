/**
 * Content pinning: verify a script on disk still matches the SHA-256 fingerprint
 * it had when a policy author audited it.
 *
 * Whitelisting a command like `node query.mjs` trusts the *path*, not the
 * *bytes*. If the script is later rewritten (by a dependency, by the agent, by
 * anything), the whitelist keeps approving it. Pinning closes that gap: record
 * the hash at audit time, re-verify it at run time.
 */

/**
 * SHA-256 (hex) of a file's contents, or `null` if it can't be read.
 */
export async function hashFile(absPath: string): Promise<string | null> {
  try {
    const buf = await Bun.file(absPath).arrayBuffer();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(buf);
    return hasher.digest("hex");
  } catch {
    return null;
  }
}

/** Strip an optional `sha256:` / `sha256-` prefix and normalise for comparison. */
function normalizeHash(hash: string): string {
  return hash.trim().replace(/^sha256[:-]/i, "").toLowerCase();
}

/**
 * Whether the file at `absPath` currently hashes to `expected`.
 * Returns `false` if the file is missing/unreadable (a missing audited file is
 * as much a mismatch as a changed one). The expected hash may optionally carry
 * a `sha256:` prefix and any casing.
 */
export async function fileMatchesHash(absPath: string, expected: string): Promise<boolean> {
  const actual = await hashFile(absPath);
  if (actual === null) return false;
  return actual === normalizeHash(expected);
}
