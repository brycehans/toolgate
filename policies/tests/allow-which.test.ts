import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowWhich from "../allow-which";

const run = adaptHandler(allowWhich.action!, allowWhich.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-which", () => {
  describe("allows safe which invocations", () => {
    const allowed = [
      "which jq",
      "which node",
      "which hyperfine",
      "which cwebp magick",
      "which rg sd choose xq htmlq pup dasel mlr",
      "which terminal-notifier 2>/dev/null",
      "which xq 2>&1",
      "which jq | head -1",
      "which node | wc -l",
      "which -a node",
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
      "which jq && jq --version",
      "which node; node --version",
      "which $(echo jq)",
      "which `id`",
      "which jq > /etc/passwd",
      "which jq &",
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

  it("passes through non-which bash commands", async () => {
    const result = await run(bash("echo hello"));
    expect(result.verdict).toBe(NEXT);
  });
});
