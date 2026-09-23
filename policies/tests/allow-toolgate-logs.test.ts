import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowToolgateLogs from "../allow-toolgate-logs";

const run = adaptHandler(allowToolgateLogs.action!, allowToolgateLogs.handler as any);

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-toolgate-logs", () => {
  it("allows: toolgate logs", async () => {
    const result = await run(bash("toolgate logs"));
    expect(result.verdict).toBe(ALLOW);
  });

  describe("does not allow other toolgate subcommands", () => {
    const rejected = [
      "toolgate run",
      "toolgate audit",
      "toolgate disable",
      "toolgate list",
      "toolgate",
    ];

    for (const cmd of rejected) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects compound commands and substitution", () => {
    const rejected = [
      "toolgate logs && rm -rf /",
      "toolgate logs | grep -i requests",
      "toolgate logs > /tmp/out",
      "toolgate $(echo logs)",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through unrelated commands", async () => {
    const result = await run(bash("ls -la"));
    expect(result.verdict).toBe(NEXT);
  });
});
