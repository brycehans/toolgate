import { describe, expect, it } from "bun:test";
import { DENY, NEXT, type ToolCall } from "toolgate";
import denyBashGrep from "../deny-bash-grep";

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("deny-bash-grep", () => {
  describe("denies grep commands", () => {
    const denied = [
      "grep -r foo .",
      "grep -rn pattern src/",
      'grep -r "shell-quote" --include="*.ts" .',
      'grep -r "foo" --include="*.ts" --exclude-dir=node_modules | wc -l',
      "egrep 'pattern' file.txt",
      "fgrep 'literal' file.txt",
      "rg pattern src/",
      "rg -t ts pattern",
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd}`, async () => {
        const result = await denyBashGrep.handler(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("ignores non-grep commands", () => {
    const ignored = [
      "ls -la",
      "find . -name '*.ts'",
      "git status",
      "cat file.txt | grep foo",  // grep is in tail, not head command
    ];

    for (const cmd of ignored) {
      it(`passes through: ${cmd}`, async () => {
        const result = await denyBashGrep.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("ignores non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Grep",
      args: { pattern: "foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await denyBashGrep.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
