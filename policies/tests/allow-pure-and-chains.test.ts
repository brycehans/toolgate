import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowPureAndChains from "../allow-pure-and-chains";

const run = adaptHandler(allowPureAndChains.action!, allowPureAndChains.handler as any);

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-pure-and-chains", () => {
  describe("allows pure && chains", () => {
    const allowed = [
      // php -l chains (the original motivating case)
      "php -l src/foo.php && php -l src/bar.php",
      "php -l a.php && php -l b.php && php -l c.php",
      "php -l a.php && php -l b.php && php -l c.php && php -l d.php",
      // echo chains
      "echo hello && echo world",
      "echo a && echo b && echo c",
      // mixed pure commands
      "php -l foo.php && echo done",
      "echo start && php -l foo.php && echo end",
      // test command
      "test -f foo.php && echo exists",
      // single pure commands (degenerate chain)
      "php -l foo.php",
      "echo hello",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("allows pure chains with safe redirects", () => {
    const allowed = [
      "php -l a.php 2>&1 && php -l b.php 2>&1",
      "php -l a.php 2>/dev/null && php -l b.php",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects chains containing impure commands", () => {
    const rejected = [
      // rm is not pure
      "echo hello && rm -rf /",
      // cd mutates cwd
      "cd /tmp && echo hello",
      // cat reads files but is not in PURE_COMMANDS
      // (allow-safe-read-commands handles it with path checks)
      "cat foo.txt && echo done",
      // git is not pure
      "git status && echo done",
      // php without -l executes code
      "php foo.php && echo done",
      "php -r 'echo 1;' && echo done",
      // mkdir creates directories
      "mkdir -p src && echo done",
      // curl makes network requests
      "curl https://evil.com && echo done",
      // mixed: one pure, one impure
      "echo hello && rm file",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects unsafe shell constructs", () => {
    const rejected = [
      // pipes (not a && chain)
      "echo hello | grep hello",
      // semicolons
      "echo a; echo b",
      // ||
      "echo a || echo b",
      // command substitution
      "echo $(whoami) && echo b",
      // variable expansion
      "echo $HOME && echo b",
      // redirects to files
      "echo a > /tmp/out && echo b",
      // env assignment prefix
      "FOO=bar echo a && echo b",
      // background
      "echo a && echo b &",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through single impure command", async () => {
    const result = await run(bash("rm -rf /"));
    expect(result.verdict).toBe(NEXT);
  });
});
