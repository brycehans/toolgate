import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowMcpPlaywright from "../allow-mcp-playwright";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: "/tmp", env: {}, projectRoot: "/tmp" },
});

describe("allow-mcp-playwright", () => {
  it("allows mcp__playwright__browser_navigate", async () => {
    const result = await allowMcpPlaywright.handler(makeCall("mcp__playwright__browser_navigate", { url: "about:blank" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows mcp__playwright__browser_snapshot", async () => {
    const result = await allowMcpPlaywright.handler(makeCall("mcp__playwright__browser_snapshot"));
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows mcp__playwright__browser_click", async () => {
    const result = await allowMcpPlaywright.handler(makeCall("mcp__playwright__browser_click", { element: "Submit", ref: "e1" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through non-playwright tools", async () => {
    const result = await allowMcpPlaywright.handler(makeCall("Bash", { command: "echo hi" }));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through other MCP tools", async () => {
    const result = await allowMcpPlaywright.handler(makeCall("mcp__context7__query-docs", { query: "test" }));
    expect(result.verdict).toBe(NEXT);
  });
});
