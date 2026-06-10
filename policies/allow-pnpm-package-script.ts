import { dirname } from "node:path";
import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

async function findPackageScripts(startDir: string): Promise<Set<string> | null> {
  let dir = startDir;
  while (true) {
    const pkgPath = `${dir}/package.json`;
    const file = Bun.file(pkgPath);
    if (await file.exists()) {
      try {
        const pkg = await file.json();
        return new Set(Object.keys(pkg.scripts ?? {}));
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const allowPnpmPackageScript: Policy = {
  name: "Allow pnpm run for package.json scripts",
  description: "Permits pnpm run <script> when <script> is defined in the nearest package.json",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] !== "pnpm" || tokens[1] !== "run") return next();
    const script = tokens[2];
    if (!script) return next();

    const scripts = await findPackageScripts(call.context.cwd);
    if (!scripts || !scripts.has(script)) return next();

    return allow();
  },
};
export default allowPnpmPackageScript;
