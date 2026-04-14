import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGitStatus from "../allow-git-status";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-git-status", () => {
  describe("allows safe git status commands", () => {
    const allowed = [
      "git status",
      "git status -s",
      "git status -sb",
      "git status --short",
      "git status --porcelain",
      "git status src/",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowGitStatus.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "git status && rm -rf /",
      "git status | bash -c evil",
      "git status\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowGitStatus.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-git-status commands", () => {
    const rejected = [
      "git diff",
      "git log",
      "echo git status",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGitStatus.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });
});
