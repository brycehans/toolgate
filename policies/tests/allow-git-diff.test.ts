import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGitDiff from "../allow-git-diff";

const run = adaptHandler(allowGitDiff.action!, allowGitDiff.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-git-diff", () => {
  describe("allows safe git diff commands", () => {
    const allowed = [
      "git diff",
      "git diff --staged",
      "git diff --cached",
      "git diff --stat",
      "git diff HEAD~1",
      "git diff main..HEAD",
      "git diff src/foo.ts",
      "git diff --name-only",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "git diff && rm -rf /",
      "git diff | bash -c evil",
      "git diff\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-git-diff commands", () => {
    const rejected = [
      "git status",
      "git log",
      "echo git diff",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });
});
