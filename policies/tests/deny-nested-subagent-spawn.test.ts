import { describe, expect, it } from "bun:test";
import { adaptHandler, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import denyNestedSubagentSpawn from "../deny-nested-subagent-spawn";

const run = adaptHandler(
  denyNestedSubagentSpawn.action!,
  denyNestedSubagentSpawn.handler as any,
);

const PROJECT = "/home/user/project";

const makeCall = (
  tool: string,
  args: Record<string, unknown>,
  agentType?: string,
): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT, additionalDirs: [], agentType },
});

describe("deny-nested-subagent-spawn", () => {
  it("denies a subagent spawning another subagent", async () => {
    const result = await run(
      makeCall("Agent", { subagent_type: "general-purpose", prompt: "x" }, "Explore"),
    );
    expect(result.verdict).toBe(DENY);
    expect("reason" in result && result.reason).toContain("Explore");
    expect("reason" in result && result.reason).toContain("general-purpose");
  });

  it("passes through when the main agent spawns a subagent", async () => {
    const result = await run(
      makeCall("Agent", { subagent_type: "Explore", prompt: "x" }),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-Agent calls from a subagent", async () => {
    const result = await run(
      makeCall("Bash", { command: "echo hi" }, "Explore"),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("still names the requested type when it is missing", async () => {
    const result = await run(makeCall("Agent", { prompt: "x" }, "general-purpose"));
    expect(result.verdict).toBe(DENY);
    expect("reason" in result && result.reason).toContain("unknown");
  });
});
