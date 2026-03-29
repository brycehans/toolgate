import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowWebFetch from "../allow-web-fetch";

const PROJECT = "/home/user/project";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
});

describe("allow-web-fetch", () => {
  it("allows WebFetch", async () => {
    const result = await allowWebFetch.handler(makeCall("WebFetch", { url: "https://example.com", prompt: "summarize" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through non-WebFetch tools", async () => {
    const result = await allowWebFetch.handler(makeCall("Bash", { command: "echo hello" }));
    expect(result.verdict).toBe(NEXT);
  });
});
