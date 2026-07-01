import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowTaskCrud from "../allow-task-crud";

const run = adaptHandler(allowTaskCrud.action!, allowTaskCrud.handler as any);

const PROJECT = "/home/user/project";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
});

describe("allow-task-crud", () => {
  for (const tool of ["TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskOutput", "TaskStop"]) {
    it(`allows ${tool}`, async () => {
      const result = await run(makeCall(tool));
      expect(result.verdict).toBe(ALLOW);
    });
  }

  it("passes through non-Task tools", async () => {
    const result = await run(makeCall("Bash", { command: "echo hello" }));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through other tools", async () => {
    const result = await run(makeCall("Read", { file_path: "/foo" }));
    expect(result.verdict).toBe(NEXT);
  });
});
