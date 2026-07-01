import type { Policy } from "../src";
import { safeBashCommand, safeBashCommandOrPipeline, getAndChainSegments, getArgs, parseShell } from "./parse-bash-ast";

/** Whitelisted npx packages — add entries as needed. */
const SAFE_NPX_PACKAGES = new Set([
  "next",
  "playwright",
  "vitest",
]);

function isAllowedNpx(tokens: string[]): boolean {
  return tokens[0] === "npx" && SAFE_NPX_PACKAGES.has(tokens[1]);
}

const allowNpxSafe: Policy = {
  name: "Allow safe npx commands",
  description: "Permits npx commands for whitelisted packages (playwright, vitest, etc.) and all Playwright MCP tools",
  action: "allow",
  handler: async (call) => {
    // Allow all Playwright MCP tools
    if (call.tool.startsWith("mcp__playwright__")) return true;

    // Simple command or pipeline (e.g. npx playwright test 2>&1 | tail -80)
    const tokens = await safeBashCommandOrPipeline(call);
    if (tokens && isAllowedNpx(tokens)) return true;

    // && chain (e.g. cd dir && npx playwright test)
    if (call.tool === "Bash" && typeof call.args.command === "string") {
      const ast = await parseShell(call.args.command);
      if (ast) {
        const segments = getAndChainSegments(ast);
        if (segments) {
          const last = getArgs(segments[segments.length - 1]);
          if (last && isAllowedNpx(last)) return true;
        }
      }
    }

    return;
  },
};
export default allowNpxSafe;
