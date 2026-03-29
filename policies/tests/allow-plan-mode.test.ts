import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowPlanMode from "../allow-plan-mode";

const PROJECT = "/home/user/project";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
});

describe("allow-plan-mode", () => {
  for (const tool of ["EnterPlanMode", "ExitPlanMode"]) {
    it(`allows ${tool}`, async () => {
      const result = await allowPlanMode.handler(makeCall(tool));
      expect(result.verdict).toBe(ALLOW);
    });
  }

  it("passes through non-plan-mode tools", async () => {
    const result = await allowPlanMode.handler(makeCall("Bash", { command: "echo hello" }));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through other tools", async () => {
    const result = await allowPlanMode.handler(makeCall("Read", { file_path: "/foo" }));
    expect(result.verdict).toBe(NEXT);
  });
});
