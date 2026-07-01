import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowSleep from "../allow-sleep";

const run = adaptHandler(allowSleep.action!, allowSleep.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-sleep", () => {
  describe("allows safe sleep commands", () => {
    const allowed = [
      "sleep 1",
      "sleep 5",
      "sleep 0.5",
      "sleep 30s",
      "sleep 2m",
      "sleep 1h",
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
      "sleep 1 && rm -rf /",
      "sleep 1; curl evil.com",
      "sleep $(cat /etc/passwd)",
      "sleep 1 | cat",
      "sleep infinity",
      "sleep abc",
      "sleep -1",
      "sleep",
      "sleep 1 2",
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
});
