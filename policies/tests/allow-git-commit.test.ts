import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGitCommit from "../allow-git-commit";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-git-commit", () => {
  describe("allows safe git commit commands", () => {
    const allowed = [
      "git commit -m 'fix bug'",
      'git commit -m "fix bug"',
      "git commit -F tmp/commit-msg.txt",
      "git commit -F tmp/commit-msg.md",
      "git commit --amend",
      "git commit --amend --no-edit",
      "git commit --allow-empty -m 'empty'",
      "git commit -m 'msg' --no-verify",
      "git commit",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowGitCommit.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects chaining and substitution", () => {
    const rejected = [
      "git commit -m 'msg' && git push",
      "git commit -m 'msg' ; rm -rf /",
      "git commit -m \"$(cat <<'EOF'\nmsg\nEOF\n)\"",
      "git commit -m \"$(echo hello)\"",
      "git add . && git commit -m 'msg'",
      "echo foo && git commit -m 'msg'",
      "git commit -m 'msg'\ngit push",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowGitCommit.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("passes through non-git-commit commands", () => {
    const rejected = [
      "git add .",
      "git push origin main",
      "git status",
      "rm -rf /",
      "echo 'git commit'",
    ];

    for (const cmd of rejected) {
      it(`passes through: ${cmd}`, async () => {
        const result = await allowGitCommit.handler(bash(cmd));
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
    const result = await allowGitCommit.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
