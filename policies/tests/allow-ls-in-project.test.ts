import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowLsInProject from "../allow-ls-in-project";

const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot },
  };
}

describe("allow-ls-in-project", () => {
  describe("allows ls within project", () => {
    const allowed = [
      "ls",
      "ls -la",
      "ls -lah",
      "ls src",
      "ls ./src",
      "ls src/components",
      "ls .",
      "ls -la src",
      `ls ${PROJECT}/src`,
      `ls ${PROJECT}`,
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowLsInProject.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects ls outside project", () => {
    const rejected = [
      "ls /etc",
      "ls /home/user/other-project",
      "ls /tmp",
      `ls ${PROJECT}-evil`,
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowLsInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects bare ls when cwd is outside project", () => {
    it("rejects ls in /tmp", async () => {
      const result = await allowLsInProject.handler(bash("ls", "/tmp"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects ls -la in /tmp", async () => {
      const result = await allowLsInProject.handler(bash("ls -la", "/tmp"));
      expect(result.verdict).toBe(NEXT);
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
        const result = await allowLsInProject.handler(bash(cmd));
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
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowLsInProject.handler(bash(cmd));
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
        const result = await allowLsInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through when no project root", async () => {
    const result = await allowLsInProject.handler(bash("ls", PROJECT, null));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-ls commands", async () => {
    const result = await allowLsInProject.handler(bash("cat /etc/passwd"));
    expect(result.verdict).toBe(NEXT);
  });
});
