import { resolve } from "node:path";
import { isWithinProject, type Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const ZERO_ARG_FLAGS = new Set([
  "-version",
  "-negate",
  "-separate",
  "+repage",
]);

const ONE_ARG_FLAGS = new Set([
  "-threshold",
  "-fuzz",
  "+opaque",
  "-channel",
  "-resize",
  "-crop",
  "-gravity",
  "-quality",
  "-connected-components",
]);

const PSEUDO_OUTPUTS = new Set(["info:", "null:"]);

const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const allowMagickInProject: Policy = {
  name: "Allow magick in project",
  description:
    "Permits ImageMagick (magick) with a conservative flag allowlist when all input and output paths are within the project root",
  action: "allow",
  handler: async (call) => {
    const args = await safeBashCommand(call);
    if (!args || args[0] !== "magick") return;
    if (!call.context.projectRoot) return;

    const positionals: string[] = [];
    let sawVersion = false;

    let i = 1;
    while (i < args.length) {
      const a = args[i];

      if (a === "-version") {
        sawVersion = true;
        i++;
        continue;
      }
      if (ZERO_ARG_FLAGS.has(a)) {
        i++;
        continue;
      }
      if (ONE_ARG_FLAGS.has(a)) {
        if (i + 1 >= args.length) return;
        i += 2;
        continue;
      }
      if (a.startsWith("-") || a.startsWith("+")) return;

      positionals.push(a);
      i++;
    }

    if (sawVersion) {
      return positionals.length === 0 ? true : undefined;
    }

    if (positionals.length < 2) return;

    const output = positionals[positionals.length - 1];
    const inputs = positionals.slice(0, -1);

    for (const p of inputs) {
      if (p.startsWith("@")) return;
      if (SCHEME_PREFIX.test(p)) return;
      if (p.startsWith("~")) return;
      const resolved = resolve(call.context.cwd, p);
      if (!isWithinProject(resolved, call.context)) return;
    }

    if (PSEUDO_OUTPUTS.has(output)) return true;
    if (output.startsWith("@")) return;
    if (SCHEME_PREFIX.test(output)) return;
    if (output.startsWith("~")) return;

    const resolvedOut = resolve(call.context.cwd, output);
    return isWithinProject(resolvedOut, call.context) ? true : undefined;
  },
};
export default allowMagickInProject;
