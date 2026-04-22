import { describe, expect, it } from "bun:test";
import { adaptHandler, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import denyGitAddAndCommit from "../deny-git-add-and-commit";

const run = adaptHandler(denyGitAddAndCommit.action!, denyGitAddAndCommit.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("deny-git-add-and-commit", () => {
  describe("denies compound add+commit commands", () => {
    const denied = [
      "git add . && git commit -m 'msg'",
      "git add -A && git commit -m 'msg'",
      "git add README.md && git commit -m 'update readme'",
      'git add . ; git commit -m "msg"',
      "git add . && git commit --amend",
      "git add -A\ngit commit -m 'msg'",
    ];

    for (const cmd of denied) {
      it(`denies: ${JSON.stringify(cmd)}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("allows standalone git add", () => {
    const allowed = [
      "git add .",
      "git add -A",
      "git add README.md",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("allows standalone git commit", () => {
    const allowed = [
      "git commit -m 'msg'",
      "git commit --amend",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("denies adversarial compound commands", () => {
    const denied = [
      "git add . || git commit -m 'msg'",
      "git add . | git commit -m 'msg'",
      "git add . & git commit -m 'msg'",
      "git   add   .  &&  git   commit  -m 'msg'",
      "git add .\n\n\ngit commit -m 'msg'",
      "git add . \\\n&& git commit -m 'msg'",
    ];

    for (const cmd of denied) {
      it(`denies: ${JSON.stringify(cmd)}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("does not false-positive on non-git commands mentioning add/commit", () => {
    const allowed = [
      "echo 'git add and git commit'",
      "git log --oneline | grep commit",
      "git stash",
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
      args: {},
      context: { cwd: "/tmp", env: {}, projectRoot: null },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
