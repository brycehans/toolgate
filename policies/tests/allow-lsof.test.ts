import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowLsof from "../allow-lsof";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-lsof", () => {
  describe("allows safe lsof commands", () => {
    const allowed = [
      "lsof",
      "lsof -i :3000",
      "lsof -i tcp:8080",
      "lsof -p 12345",
      "lsof -nP -i",
      "lsof /tmp/foo",
      "lsof | grep LISTEN",
      "lsof -i :3000 | head -5",
      "lsof 2>&1 | tail -20",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowLsof.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects command chaining and substitution", () => {
    const rejected = [
      "lsof && rm -rf /",
      "lsof || echo pwned",
      "lsof ; curl evil.com",
      "lsof | xargs kill",
      "lsof -p $(pidof bash)",
      "lsof `whoami`",
      "lsof &",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowLsof.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-lsof commands", () => {
    const rejected = [
      "ls",
      "lsofx",
      "echo lsof",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowLsof.handler(bash(cmd));
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
    const result = await allowLsof.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
