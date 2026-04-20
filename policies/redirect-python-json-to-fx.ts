import { deny, next, type Policy } from "../src";
import { parseShell, getPipelineCommands, getArgs } from "./parse-bash-ast";

const JSON_DESCRIPTION_PATTERNS = [
  /\bjson\b/i,
  /\bpretty[- ]?print/i,
  /\bparse\b.*\b(response|output|result|data|config|payload)\b/i,
  /\b(response|output|result|data|config|payload)\b.*\bparse\b/i,
  /\bextract\b.*\b(field|key|value|property)\b/i,
  /\b(field|key|value|property)\b.*\bextract\b/i,
  /\binspect\b.*\b(response|output|api|config)\b/i,
  /\bformat\b.*\b(response|output|api)\b/i,
  /\bcheck\b.*\b(response|api|endpoint)\b/i,
];

function descriptionSuggestsJsonProcessing(description: string): boolean {
  return JSON_DESCRIPTION_PATTERNS.some((p) => p.test(description));
}

function commandContainsPython(cmds: ReturnType<typeof getPipelineCommands>): boolean {
  if (!cmds) return false;
  for (const cmd of cmds) {
    const args = getArgs(cmd);
    if (!args) continue;
    if (args[0] === "python3" || args[0] === "python") return true;
  }
  return false;
}

function isPythonJsonTool(cmds: ReturnType<typeof getPipelineCommands>): boolean {
  if (!cmds) return false;
  for (const cmd of cmds) {
    const args = getArgs(cmd);
    if (!args) continue;
    if (
      (args[0] === "python3" || args[0] === "python") &&
      args[1] === "-m" &&
      args[2] === "json.tool"
    ) {
      return true;
    }
  }
  return false;
}

const DENY_MESSAGE =
  "Use `fx` for JSON extraction (`| fx '.field.subfield'`), " +
  "`gron` for path discovery (`| gron | grep key`), " +
  "or the Read tool to inspect JSON files directly. " +
  "Only use Python for complex transforms that genuinely need it (atomic file writes, multi-step logic with non-JSON inputs).";

const redirectPythonJsonToFx: Policy = {
  name: "Redirect python JSON to fx",
  description:
    "Blocks python3 -m json.tool (always) and python3 commands whose description suggests JSON processing — suggests fx/gron instead",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();

    const ast = await parseShell(call.args.command);
    if (!ast || ast.Stmts.length !== 1) return next();

    const cmds = getPipelineCommands(ast.Stmts[0]);
    if (!cmds) return next();

    // Hard block: python3 -m json.tool is always just pretty-printing
    if (isPythonJsonTool(cmds)) {
      return deny(
        "`python3 -m json.tool` is just pretty-printing. Use `| fx .` instead, or `| fx` for interactive browsing. " +
          DENY_MESSAGE,
      );
    }

    // Intent-based block: python3 + JSON-related description
    if (commandContainsPython(cmds)) {
      const description = call.args.description;
      if (typeof description === "string" && descriptionSuggestsJsonProcessing(description)) {
        return deny(DENY_MESSAGE);
      }
    }

    return next();
  },
};
export default redirectPythonJsonToFx;
