import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

/** CDK subcommands that are read-only / informational */
const SAFE_SUBCOMMANDS = new Set([
  "ls",
  "list",
  "diff",
  "synth",
  "synthesize",
  "doctor",
  "context",
  "metadata",
  "notices",
]);

/** CDK flags that act as read-only subcommands */
const SAFE_FLAGS = new Set([
  "--version",
  "-v",
  "--help",
  "-h",
]);

const allowCdk: Policy = {
  name: "Allow cdk read-only",
  description:
    "Auto-allows read-only cdk commands (ls, diff, synth, doctor, etc.); requires approval for deploy, destroy, bootstrap, import, migrate, rollback, watch",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens || tokens[0] !== "cdk") return next();

    if (tokens.length >= 2 && SAFE_FLAGS.has(tokens[1])) return allow();

    let subcommand: string | undefined;
    for (let i = 1; i < tokens.length; i++) {
      if (!tokens[i].startsWith("-")) {
        subcommand = tokens[i];
        break;
      }
    }
    if (!subcommand) return next();

    if (SAFE_SUBCOMMANDS.has(subcommand)) return allow();

    return next();
  },
};
export default allowCdk;
