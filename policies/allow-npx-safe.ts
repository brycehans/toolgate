import { allow, next, type Policy } from "../src";
import { safeBashCommand, safeBashCommandOrPipeline, getAndChainSegments, getArgs, parseShell } from "./parse-bash-ast";

/**
 * Whitelisted npx packages.
 * - `true` means all subcommands are safe
 * - A `Set<string>` lists destructive subcommands that should NOT be auto-allowed
 */
const SAFE_NPX_PACKAGES: Record<string, true | Set<string>> = {
  next: true,
  playwright: true,
  vitest: true,
  cdk: new Set(["deploy", "destroy"]),
};

function isAllowedNpx(tokens: string[]): boolean {
  if (tokens[0] !== "npx") return false;
  const rule = SAFE_NPX_PACKAGES[tokens[1]];
  if (!rule) return false;
  if (rule === true) return true;
  // Block if any argument matches a destructive subcommand
  return !tokens.slice(2).some(t => rule.has(t));
}

const allowNpxSafe: Policy = {
  name: "Allow safe npx commands",
  description: "Permits npx commands for whitelisted packages (playwright, vitest, etc.) and all Playwright MCP tools",
  handler: async (call) => {
    // Allow all Playwright MCP tools
    if (call.tool.startsWith("mcp__playwright__")) return allow();

    // Simple command or pipeline (e.g. npx playwright test 2>&1 | tail -80)
    const tokens = await safeBashCommandOrPipeline(call);
    if (tokens && isAllowedNpx(tokens)) return allow();

    // && chain (e.g. cd dir && npx playwright test)
    if (call.tool === "Bash" && typeof call.args.command === "string") {
      const ast = await parseShell(call.args.command);
      if (ast) {
        const segments = getAndChainSegments(ast);
        if (segments) {
          const last = getArgs(segments[segments.length - 1]);
          if (last && isAllowedNpx(last)) return allow();
        }
      }
    }

    return next();
  },
};
export default allowNpxSafe;
