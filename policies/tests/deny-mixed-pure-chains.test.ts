import { describe, expect, it } from "bun:test";
import { DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import denyMixedPureChains from "../deny-mixed-pure-chains";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("deny-mixed-pure-chains", () => {
  describe("denies mixed pure + non-pure chains", () => {
    const denied = [
      "sleep 5 && git status",
      "echo starting && bun test",
      "sleep 2 && curl https://example.com",
      "echo hello; git log",
      "sleep 1\ngit diff",
      "true && npm install",
      "pwd && rm -rf /tmp/foo",
      "sleep 5 || git status",
      "echo start && git add . && echo done",
    ];

    for (const cmd of denied) {
      it(`denies: ${JSON.stringify(cmd)}`, async () => {
        const result = await denyMixedPureChains.handler(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("passes through all-pure chains", () => {
    const allowed = [
      "sleep 5 && echo done",
      "true && echo ok",
      "echo one; echo two",
      "sleep 1 && true && echo finished",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${JSON.stringify(cmd)}`, async () => {
        const result = await denyMixedPureChains.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("passes through all-non-pure chains", () => {
    const allowed = [
      "git add . && git commit -m 'msg'",
      "bun test && bun build",
      "ls && cat foo.txt",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${JSON.stringify(cmd)}`, async () => {
        const result = await denyMixedPureChains.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("passes through single commands", () => {
    const allowed = [
      "sleep 5",
      "git status",
      "echo hello",
      "bun test",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await denyMixedPureChains.handler(bash(cmd));
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
    const result = await denyMixedPureChains.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
