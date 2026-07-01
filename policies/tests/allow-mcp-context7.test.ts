import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowMcpContext7 from "../allow-mcp-context7";

const run = adaptHandler(allowMcpContext7.action!, allowMcpContext7.handler as any);

const PROJECT = "/home/user/project";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
});

describe("allow-mcp-context7", () => {
  it("allows mcp__context7__resolve-library-id", async () => {
    const result = await run(
      makeCall("mcp__context7__resolve-library-id", { query: "react hooks", libraryName: "react" })
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows mcp__context7__query-docs", async () => {
    const result = await run(
      makeCall("mcp__context7__query-docs", { libraryId: "/vercel/next.js", query: "routing" })
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through non-Context7 tools", async () => {
    const result = await run(makeCall("Bash", { command: "echo hello" }));
    expect(result.verdict).toBe(NEXT);
  });
});
