import { resolve } from "node:path";
import { hashFile } from "./pin";

/**
 * Print the SHA-256 of each given file, sha256sum-style (`<hex>  <path>`), for
 * recording in a `pinnedScripts({ ... })` map. Exits non-zero if any file is
 * unreadable.
 */
export async function hashCmd(args: string[]): Promise<void> {
  const paths = args.filter((a) => !a.startsWith("-"));
  if (paths.length === 0) {
    console.error("Usage: toolgate hash <file> [file...]");
    process.exit(1);
  }

  let failed = false;
  for (const p of paths) {
    const abs = resolve(process.cwd(), p);
    const hash = await hashFile(abs);
    if (hash === null) {
      console.error(`toolgate hash: cannot read ${p}`);
      failed = true;
      continue;
    }
    console.log(`${hash}  ${p}`);
  }

  if (failed) process.exit(1);
}
