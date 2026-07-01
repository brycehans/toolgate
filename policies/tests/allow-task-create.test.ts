import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowTaskCreate from "../allow-task-create";

const run = adaptHandler(allowTaskCreate.action!, allowTaskCreate.handler as any);

const PROJECT = "/home/user/project";

describe("allow-task-create", () => {
  it("allows TaskCreate", async () => {
    const call: ToolCall = {
      tool: "TaskCreate",
      args: { subject: "Fix bug", description: "Fix the auth bug" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await run(call);
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through non-TaskCreate tools", async () => {
    const call: ToolCall = {
      tool: "Bash",
      args: { command: "echo hello" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through other tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
