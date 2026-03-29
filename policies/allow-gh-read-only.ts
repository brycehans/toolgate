import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const readOnlySubcommands: Record<string, Set<string>> = {
  issue: new Set(["view", "list"]),
  pr: new Set(["view", "list", "diff", "checks"]),
  run: new Set(["view", "list", "watch"]),
  search: new Set(["issues", "prs", "repos", "code", "commits"]),
  repo: new Set(["view"]),
  release: new Set(["view", "list"]),
};

const allowGhReadOnly: Policy = {
  name: "Allow gh read-only",
  description: "Permits read-only gh CLI commands (view, list, diff, checks, search)",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] !== "gh") return next();

    const command = tokens[1];
    const subcommand = tokens[2];
    const allowed = readOnlySubcommands[command];

    if (allowed && subcommand && allowed.has(subcommand)) return allow();

    if (command === "api") {
      const mutatingFlags = new Set(["-X", "--method", "-f", "-F", "--field", "--raw-field", "--input"]);
      for (let i = 2; i < tokens.length; i++) {
        const t = tokens[i];
        if (mutatingFlags.has(t)) return next();
        if (t.startsWith("-X") && t.length > 2) return next();
      }
      return allow();
    }

    return next();
  },
};
export default allowGhReadOnly;
