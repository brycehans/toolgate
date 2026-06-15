import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowLs from "../allow-ls";

const run = adaptHandler(allowLs.action!, allowLs.handler as any);

const HOME = homedir();
const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot },
  };
}

describe("allow-ls", () => {
  describe("allows ls against non-dot paths", () => {
    const allowed = [
      "ls",
      "ls -la",
      "ls -lah",
      "ls src",
      "ls ./src",
      "ls src/components",
      "ls .",
      "ls ..",
      "ls -la src",
      `ls ${PROJECT}/src`,
      `ls ${PROJECT}`,
      "ls /etc",
      "ls /home/user/other-project",
      "ls /tmp",
      "ls /Applications",
      `ls ${PROJECT}-evil`,
      `ls ${HOME}/Dev`,
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects ls against dot-prefixed segments", () => {
    const rejected = [
      "ls .git",
      "ls .env",
      "ls -la .ssh",
      "ls src/.cache",
      "ls ./.next",
      "ls ~/.ssh",
      "ls ~/.aws/credentials.d",
      `ls ${HOME}/.claude`,
      `ls ${HOME}/.claude/plugins/marketplaces`,
      "ls /home/user/.gnupg",
      `ls ${PROJECT}/.git/refs`,
      "ls -la src/.cache nested",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("allows ls regardless of cwd", () => {
    it("allows ls in /tmp", async () => {
      const result = await run(bash("ls", "/tmp"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows ls -la in /tmp", async () => {
      const result = await run(bash("ls -la", "/tmp"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows ls when there is no project root", async () => {
      const result = await run(bash("ls", PROJECT, null));
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "ls && rm -rf /",
      "ls | xargs cat /etc/passwd",
      "ls\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("allows ls piped to safe filters", () => {
    const allowed = [
      "ls -la | grep -i site",
      "ls -la | head -20",
      "ls | wc -l",
      "ls -la | grep foo | head -5",
      `ls ${PROJECT}/src | sort`,
      "ls -la | grep test | wc -l",
      "ls /etc | grep host",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects ls piped to unsafe commands", () => {
    const rejected = [
      "ls | xargs rm",
      "ls | sh -c 'cat'",
      "ls | tee /tmp/out",
      "ls | sort -o outfile",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through non-ls commands", async () => {
    const result = await run(bash("cat /etc/passwd"));
    expect(result.verdict).toBe(NEXT);
  });
});
