import { describe, expect, it } from "bun:test";
import { adaptHandler, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import denyAndChains from "../deny-and-chains";

const run = adaptHandler(denyAndChains.action!, denyAndChains.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("deny-and-chains", () => {
  describe("denies impure && chains with steering", () => {
    const cases = [
      "mkdir tmp && ls tmp",
      "mkdir -p tmp && date",
      "python3 -c 'print(1)' && wc -l file",
      "ls /a && ls /b",
      "ls /a && cat /b",
      "rm out && rmdir tmp",
      "sleep 5 && gh pr list",
      "ls /a && ls /b && ls /c",
      "grep foo file | head > out && wc -l out",
      "ls A && grep x file | head",
      "claude-session-search --deep > out.txt && wc -l out.txt",
    ];
    for (const cmd of cases) {
      it(`denies: ${cmd}`, async () => {
        const r = await run(bash(cmd));
        expect(r.verdict).toBe(DENY);
        expect(r.reason).toMatch(/separate Bash call|atomically/);
      });
    }
  });

  describe("exempts env-setter chains", () => {
    const cases = [
      'eval "$(fnm env)" && fnm use 25',
      "eval \"$(fnm env)\" && fnm use 25 && codex",
      "source .env && cmd",
      ". .env && cmd",
      "export FOO=bar && cmd",
      "cmd && source .env",
      "cmd1 && eval \"$(fnm env)\" && cmd2",
    ];
    for (const cmd of cases) {
      it(`passes through: ${cmd}`, async () => {
        const r = await run(bash(cmd));
        expect(r.verdict).toBe(NEXT);
      });
    }
  });

  describe("doesn't fire on non-chain commands", () => {
    const cases = [
      "ls",
      "ls /a /b /c",
      "grep foo file | head -10",
      "cat file > out",
      "cd /some/path",
      "git status",
    ];
    for (const cmd of cases) {
      it(`passes through: ${cmd}`, async () => {
        const r = await run(bash(cmd));
        expect(r.verdict).toBe(NEXT);
      });
    }
  });

  describe("out-of-scope separators (|| and ;) — not handled", () => {
    const cases = [
      "cmd1 || cmd2",
      "cmd1 ; cmd2",
      "ls /a ; ls /b",
    ];
    for (const cmd of cases) {
      it(`passes through (intentional): ${cmd}`, async () => {
        const r = await run(bash(cmd));
        expect(r.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/foo" },
      context: { cwd: "/tmp", env: {}, projectRoot: null },
    };
    const r = await run(call);
    expect(r.verdict).toBe(NEXT);
  });
});
