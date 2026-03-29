import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowWebSearch from "../allow-web-search";

const PROJECT = "/home/user/project";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
});

describe("allow-web-search", () => {
  it("allows WebSearch", async () => {
    const result = await allowWebSearch.handler(makeCall("WebSearch", { query: "test query" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through non-WebSearch tools", async () => {
    const result = await allowWebSearch.handler(makeCall("Bash", { command: "echo hello" }));
    expect(result.verdict).toBe(NEXT);
  });
});
