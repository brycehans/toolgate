import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowExactCommands from "../allow-exact-commands";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-exact-commands", () => {
  describe("allows whitelisted commands", () => {
    const allowed = [
      "git status",
      "git diff",
      "git log --oneline -5",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowExactCommands(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  it("allows with leading/trailing whitespace", async () => {
    const result = await allowExactCommands(bash("  git status  "));
    expect(result.verdict).toBe(ALLOW);
  });

  describe("rejects commands with injected suffixes", () => {
    const rejected = [
      "git status && rm -rf /",
      "git status; echo pwned",
      "git diff | cat /etc/passwd",
      "git log --oneline -5 ; curl evil.com",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowExactCommands(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects similar but non-exact commands", () => {
    const rejected = [
      "git status -u",
      "git diff --staged",
      "git log --oneline -10",
      "git log --oneline -5 --all",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowExactCommands(bash(cmd));
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
    const result = await allowExactCommands(call);
    expect(result.verdict).toBe(NEXT);
  });
});
