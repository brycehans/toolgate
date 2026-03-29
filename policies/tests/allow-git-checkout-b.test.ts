import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowGitCheckoutB from "../allow-git-checkout-b";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-git-checkout-b", () => {
  describe("allows branch creation", () => {
    const allowed = [
      "git checkout -b new-feature",
      "git checkout -b fix/login-bug",
      "git checkout -b my-branch origin/main",
      "git checkout -b hotfix v1.2.3",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowGitCheckoutB.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects non-branch-creation checkout", () => {
    const rejected = [
      "git checkout main",
      "git checkout -- file.txt",
      "git checkout .",
      "git checkout -B force-branch",
      "git checkout -b",
      "git checkout -b --orphan",
      "git checkout --orphan new-branch",
      "git checkout -f main",
      "git checkout --detach abc123",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGitCheckoutB.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "git checkout -b foo && rm -rf /",
      "git checkout -b foo; echo pwned",
      "git checkout -b foo\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowGitCheckoutB.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-checkout commands", () => {
    const rejected = [
      "git status",
      "git branch -b foo",
      "echo git checkout -b foo",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGitCheckoutB.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });
});
