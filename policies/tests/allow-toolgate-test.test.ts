import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowToolgateTest from "../allow-toolgate-test";

const run = adaptHandler(allowToolgateTest.action!, allowToolgateTest.handler as any);

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-toolgate-test", () => {
  describe("allows toolgate test invocations", () => {
    const allowed = [
      `toolgate test Bash '{"command": "rm -rf /etc/passwd"}'`,
      `toolgate test Bash '{"command": "ls"}'`,
      `toolgate test Bash '{"command": "rm -rf ./tmp/foo"}' --cwd /home/user/project`,
      `toolgate test Read '{"file_path": "/etc/shadow"}'`,
      `toolgate test --json Bash '{"command": "git push"}'`,
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
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
      `toolgate test Bash '{"command": "ls"}' && rm -rf /`,
      `toolgate test Bash '{"command": "ls"}' | grep DENY`,
      `toolgate test Bash $(echo something)`,
      `toolgate test Bash '{"command": "ls"}' > /tmp/out`,
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
