import { describe, expect, it } from "bun:test";
import { adaptHandler, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import denyGitChained from "../deny-git-chained";

const run = adaptHandler(denyGitChained.action!, denyGitChained.handler as any);

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("deny-git-chained", () => {
  describe("denies git chained with &&", () => {
    const denied = [
      "git checkout develop && git pull origin develop",
      "git fetch origin main && git diff main...origin/main",
      "git add -A && git commit -m 'fix'",
      "git stash && git checkout main && git pull",
      "git status && echo '---' && git diff",
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("denies git chained with ;", () => {
    const denied = [
      "git checkout develop; git pull origin develop",
      "git add .; git commit -m 'update'",
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("denies git chained with ||", () => {
    it("denies: git pull || git fetch", async () => {
      const result = await run(bash("git pull || git fetch"));
      expect(result.verdict).toBe(DENY);
    });
  });

  describe("passes through standalone git commands", () => {
    const allowed = [
      "git status",
      "git log --oneline -5",
      "git checkout develop",
      "git pull origin main",
      "git diff HEAD~1",
      "git commit -m 'fix bug'",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("passes through git piped to filters", () => {
    const allowed = [
      "git log --oneline | head -5",
      "git diff | grep TODO",
      "git branch -a | sort",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("passes through non-git chained commands", () => {
    const allowed = [
      "echo hello && echo world",
      "ls -la && cat file.ts",
      "chmod +x script.sh && bash script.sh",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
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
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
