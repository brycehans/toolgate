import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const SAFE_SUBCOMMANDS = new Set([
  "build",
  "test",
  "vet",
  "version",
  "env",
  "list",
  "doc",
  "fmt",
  "mod",
  "help",
  "tool",
  "work",
]);

const allowGo: Policy = {
  name: "Allow go commands",
  description:
    "Permits non-destructive Go commands (build, test, vet, env, list, doc, fmt, mod, etc.)",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] !== "go") return next();
    if (tokens.length < 2) return next();
    if (!SAFE_SUBCOMMANDS.has(tokens[1])) return next();
    return allow();
  },
};
export default allowGo;
