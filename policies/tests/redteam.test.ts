import { describe, expect, it } from "bun:test";
import { runPolicyWithTrace, ALLOW, type ToolCall } from "@brycehanscomb/toolgate";
import { builtinPolicies } from "../index";
import { redTeamCases } from "./redteam-cases";

/**
 * Regression gate: no dangerous call may be auto-ALLOWed by the built-in
 * policy set. DENY or ASK are both fine — only ALLOW is a false negative.
 *
 * Runs from a neutral fake project root so home-relative and system paths in
 * the cases are correctly outside the project.
 */
const PROJECT = "/home/user/project";

function contextFor(): ToolCall["context"] {
  return { cwd: PROJECT, env: {}, projectRoot: PROJECT, additionalDirs: [] };
}

describe("red team: no dangerous call is auto-allowed", () => {
  for (const c of redTeamCases) {
    it(`does not ALLOW: ${c.desc}`, async () => {
      const call: ToolCall = { tool: c.tool, args: c.args, context: contextFor() };
      const { result, name } = await runPolicyWithTrace(builtinPolicies, call);
      if (result.verdict === ALLOW) {
        throw new Error(`FALSE NEGATIVE: "${c.desc}" auto-allowed by policy "${name}"\n  ${JSON.stringify(c.args)}`);
      }
    });
  }
});
