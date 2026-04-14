import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowTaskCrud from "../allow-task-crud";

const PROJECT = "/home/user/project";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
});

describe("allow-task-crud", () => {
  for (const tool of ["TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskOutput", "TaskStop"]) {
    it(`allows ${tool}`, async () => {
      const result = await allowTaskCrud.handler(makeCall(tool));
      expect(result.verdict).toBe(ALLOW);
    });
  }

  it("passes through non-Task tools", async () => {
    const result = await allowTaskCrud.handler(makeCall("Bash", { command: "echo hello" }));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through other tools", async () => {
    const result = await allowTaskCrud.handler(makeCall("Read", { file_path: "/foo" }));
    expect(result.verdict).toBe(NEXT);
  });
});
