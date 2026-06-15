import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowDate from "../allow-date";

const run = adaptHandler(allowDate.action!, allowDate.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-date", () => {
  describe("allows safe date commands", () => {
    const allowed = [
      "date",
      "date +%Y-%m-%d",
      "date '+%H:%M:%S'",
      "date -u",
      "date --utc",
      "date -R",
      "date --rfc-3339=seconds",
      "date --iso-8601=ns",
      "date -Iseconds",
      "date -d 'next monday'",
      "date --date='2025-01-01'",
      "date -d '2025-01-01' +%s",
      "date -r 1700000000",
      "date -u +%s",
      "date +%z && date +%Z",
      "date && date +%s",
      "date +%s && date -u +%s && date -R",
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
      "date -s '2025-01-01'",
      "date --set='2025-01-01'",
      "date 010100002025",
      "date && rm -rf /",
      "date; curl evil.com",
      "date $(whoami)",
      "date | cat",
      "date && rm -rf /tmp/x",
      "date +%s && date -s '2025-01-01'",
      "date || echo fallback",
      "date; date",
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

  it("passes through non-date bash commands", async () => {
    const result = await run(bash("echo hello"));
    expect(result.verdict).toBe(NEXT);
  });
});
