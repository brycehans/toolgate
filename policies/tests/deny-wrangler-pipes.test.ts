import { describe, expect, it } from "bun:test";
import { adaptHandler, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import denyWranglerPipes from "../deny-wrangler-pipes";

const run = adaptHandler(denyWranglerPipes.action!, denyWranglerPipes.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("deny-wrangler-pipes", () => {
  describe("denies pipes into data-wranglers with steering message", () => {
    const cases = [
      // Dominant pattern from failure logs: cat | fx
      "cat foo.json | fx '.users.map(u => u.name)'",
      "cat /Users/bryce/long/path.json | fx 'Object.keys(_)'",
      // cat | jq
      "cat foo.json | jq '.users[]'",
      "cat config.yaml | yq '.services.web'",
      // network LHS | wrangler
      "gh api repos/x/y | jq '.name'",
      "gh issue view 731 --json title,body | fx '.title'",
      "xh GET http://api.example.com | fx '.data'",
      "xhs api.example.com | jq '.id'",
      // chained pipes — first wrangler fires
      "cat foo.json | jq '.x' | jq '.y'",
      "cat foo.json | gron | grep email | jq '.'",
      // XML / HTML wranglers
      "cat foo.xml | xq -x '//book/title'",
      "cat foo.html | htmlq 'a.link'",
      // safe redirect on LHS still triggers
      "gh api foo 2>/dev/null | fx '.id'",
    ];
    for (const cmd of cases) {
      it(`denies: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(DENY);
        expect(result.reason).toMatch(/save|tmp\//);
      });
    }
  });

  describe("passes through wrangler invocations that don't waste an LHS", () => {
    const cases = [
      // Direct file args — no pipe, nothing to waste
      "jq '.foo' file.json",
      "fx file.json '.foo'",
      "yq '.foo' file.yaml",
      "xq -x '//book' file.xml",
      // Wrangler with no positional filter (rare, but legal)
      "cat foo.json | jq",
      // gron is a pure transformer, not a filter-bearing wrangler
      "cat foo.json | gron",
      "cat foo.json | gron | grep email",
      // No wrangler at all
      "cat foo.json",
      "gh api foo",
      "echo hi | grep h",
    ];
    for (const cmd of cases) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("trivial-filter edge cases still fire (per design — no exceptions)", () => {
    const cases = [
      "echo '{}' | jq .",
      "cat foo.json | jq .",
    ];
    for (const cmd of cases) {
      it(`denies: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/foo" },
      context: { cwd: "/tmp", env: {}, projectRoot: null },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
