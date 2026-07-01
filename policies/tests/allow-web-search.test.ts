import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowWebSearch from "../allow-web-search";

const run = adaptHandler(allowWebSearch.action!, allowWebSearch.handler as any);

const PROJECT = "/home/user/project";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
});

describe("allow-web-search", () => {
  it("allows WebSearch", async () => {
    const result = await run(makeCall("WebSearch", { query: "test query" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through non-WebSearch tools", async () => {
    const result = await run(makeCall("Bash", { command: "echo hello" }));
    expect(result.verdict).toBe(NEXT);
  });
});
