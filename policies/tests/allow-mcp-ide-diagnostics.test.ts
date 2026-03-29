import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowMcpIdeDiagnostics from "../allow-mcp-ide-diagnostics";

const PROJECT = "/home/user/project";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
});

describe("allow-mcp-ide-diagnostics", () => {
  it("allows mcp__ide__getDiagnostics", async () => {
    const result = await allowMcpIdeDiagnostics.handler(makeCall("mcp__ide__getDiagnostics", { uri: "file:///test.ts" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows mcp__ide__getDiagnostics without args", async () => {
    const result = await allowMcpIdeDiagnostics.handler(makeCall("mcp__ide__getDiagnostics"));
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through non-getDiagnostics tools", async () => {
    const result = await allowMcpIdeDiagnostics.handler(makeCall("Bash", { command: "echo hello" }));
    expect(result.verdict).toBe(NEXT);
  });
});
