import { describe, expect, it } from "bun:test";
import { DENY, NEXT, type ToolCall } from "toolgate";
import denyCdChained from "../deny-cd-chained";

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("deny-cd-chained", () => {
  describe("denies cd chained with &&", () => {
    const denied = [
      "cd ~/Dev/project && git log",
      "cd /tmp && ls -la",
      "cd src && echo hello && cat file.ts",
      "cd ~/Dev/project && echo '=== UPSTREAM ===' && git log origin/master --oneline -3",
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd}`, async () => {
        const result = await denyCdChained.handler(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("denies cd chained with ;", () => {
    const denied = [
      "cd ~/Dev/project; git log",
      "cd /tmp; ls -la",
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd}`, async () => {
        const result = await denyCdChained.handler(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("denies cd chained with ||", () => {
    it("denies: cd /tmp || echo failed", async () => {
      const result = await denyCdChained.handler(bash("cd /tmp || echo failed"));
      expect(result.verdict).toBe(DENY);
    });
  });

  describe("passes through standalone cd", () => {
    const allowed = [
      "cd ~/Dev/project",
      "cd src",
      "cd ..",
      "cd",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await denyCdChained.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("passes through non-cd commands", () => {
    const allowed = [
      "git log && echo done",
      "ls -la",
      "echo hello && echo world",
      "cat file.ts",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await denyCdChained.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await denyCdChained.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
