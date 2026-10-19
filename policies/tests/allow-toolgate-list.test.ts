import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowToolgateList from "../allow-toolgate-list";

const run = adaptHandler(allowToolgateList.action!, allowToolgateList.handler as any);

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-toolgate-list", () => {
  it("allows: toolgate list", async () => {
    const result = await run(bash("toolgate list"));
    expect(result.verdict).toBe(ALLOW);
  });

  describe("does not allow other toolgate subcommands", () => {
    const rejected = [
      "toolgate run",
      "toolgate audit",
      "toolgate disable",
      "toolgate logs",
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
      "toolgate list && rm -rf /",
      "toolgate list | grep -i git",
      "toolgate list > /tmp/out",
      "toolgate $(echo list)",
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
