import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowCdk from "../allow-cdk";

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-cdk", () => {
  describe("auto-allows read-only commands", () => {
    const allowed = [
      "cdk ls",
      "cdk list",
      "cdk diff",
      "cdk diff MyStack",
      "cdk synth",
      "cdk synthesize",
      "cdk doctor",
      "cdk context",
      "cdk metadata MyStack",
      "cdk notices",
      "cdk --version",
      "cdk -v",
      "cdk --help",
      "cdk -h",
      "cdk ls --long",
      "cdk diff | head -50",
      "cdk synth 2>&1 | tail -20",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowCdk.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("requires approval for mutating commands", () => {
    const requireApproval = [
      "cdk deploy",
      "cdk deploy MyStack",
      "cdk deploy --all",
      "cdk destroy",
      "cdk destroy MyStack",
      "cdk destroy --all",
      "cdk bootstrap",
      "cdk bootstrap aws://123/us-east-1",
      "cdk import",
      "cdk migrate",
      "cdk rollback",
      "cdk watch",
      "cdk acknowledge",
      "cdk init app",
    ];

    for (const cmd of requireApproval) {
      it(`requires approval: ${cmd}`, async () => {
        const result = await allowCdk.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("passes through non-cdk commands", () => {
    it("ignores non-Bash tools", async () => {
      const call: ToolCall = {
        tool: "Read",
        args: { file_path: "/foo" },
        context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
      };
      const result = await allowCdk.handler(call);
      expect(result.verdict).toBe(NEXT);
    });

    it("ignores non-cdk bash commands", async () => {
      const result = await allowCdk.handler(bash("git status"));
      expect(result.verdict).toBe(NEXT);
    });

    it("ignores compound commands", async () => {
      const result = await allowCdk.handler(bash("cdk ls && cdk deploy"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  it("falls through for bare cdk with no subcommand", async () => {
    const result = await allowCdk.handler(bash("cdk"));
    expect(result.verdict).toBe(NEXT);
  });
});
