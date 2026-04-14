import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowAskUser from "../allow-ask-user";

const PROJECT = "/home/user/project";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
});

describe("allow-ask-user", () => {
  it("allows AskUserQuestion", async () => {
    const result = await allowAskUser.handler(makeCall("AskUserQuestion", { question: "What should I do?" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through non-AskUserQuestion tools", async () => {
    const result = await allowAskUser.handler(makeCall("Bash", { command: "echo hello" }));
    expect(result.verdict).toBe(NEXT);
  });
});
