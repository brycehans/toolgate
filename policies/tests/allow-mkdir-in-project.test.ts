import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowMkdirInProject from "../allow-mkdir-in-project";

const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot },
  };
}

describe("allow-mkdir-in-project", () => {
  describe("allows mkdir within project", () => {
    const allowed = [
      "mkdir src/components",
      "mkdir -p src/components/ui",
      "mkdir ./tmp",
      `mkdir ${PROJECT}/dist`,
      `mkdir -p ${PROJECT}/src/lib`,
      "mkdir -p src/a src/b",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowMkdirInProject.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects mkdir outside project", () => {
    const rejected = [
      "mkdir /etc/bad",
      "mkdir /tmp/stuff",
      "mkdir /home/user/other-project/dir",
      `mkdir ${PROJECT}-evil/src`,
      "mkdir src /tmp/escape",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowMkdirInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects mkdir with no path args", () => {
    it("rejects bare mkdir", async () => {
      const result = await allowMkdirInProject.handler(bash("mkdir"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects mkdir -p (no path)", async () => {
      const result = await allowMkdirInProject.handler(bash("mkdir -p"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "mkdir src && rm -rf /",
      "mkdir src; echo pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowMkdirInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through when no project root", async () => {
    const result = await allowMkdirInProject.handler(bash("mkdir src", PROJECT, null));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-mkdir commands", async () => {
    const result = await allowMkdirInProject.handler(bash("ls -la"));
    expect(result.verdict).toBe(NEXT);
  });
});
