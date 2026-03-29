import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowBashFindInProject from "../allow-bash-find-in-project";

const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot },
  };
}

describe("allow-bash-find-in-project", () => {
  describe("allows find within project", () => {
    const allowed = [
      "find",
      "find .",
      "find ./src",
      "find src",
      "find src -name '*.ts'",
      "find . -type f -name '*.ts'",
      "find . -maxdepth 2 -name '*.json'",
      `find ${PROJECT}/src`,
      `find ${PROJECT}`,
      `find ${PROJECT} -name '*.ts'`,
      "find . -name '*.ts' -o -name '*.js'",
      "find . -type f -name '*.blade.php' -o -name '*.tsx' -o -name '*.ts'",
      "find . -name 'main.ts' -o -name 'main.tsx'",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowBashFindInProject.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects find outside project", () => {
    const rejected = [
      "find /etc",
      "find /home/user/other-project",
      "find /tmp",
      `find ${PROJECT}-evil`,
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowBashFindInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects bare find when cwd is outside project", () => {
    it("rejects find in /tmp", async () => {
      const result = await allowBashFindInProject.handler(bash("find", "/tmp"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects find . in /tmp", async () => {
      const result = await allowBashFindInProject.handler(bash("find .", "/tmp"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "find . && rm -rf /",
      "find . | xargs rm",
      "find .\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowBashFindInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("allows find piped to safe filters", () => {
    const allowed = [
      "find . -name '*.ts' | head -10",
      "find . -name '*.ts' | grep src",
      "find . -type f | wc -l",
      "find . -name '*.php' | grep -i controller | head -5",
      `find ${PROJECT}/src -name '*.ts' | sort`,
      "find . | tail -20",
      "find . -name '*.ts' | cut -d/ -f2 | sort | uniq",
      "find resources -type f | grep -E '(form|Form)' | sort | head -80",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowBashFindInProject.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects find piped to unsafe commands", () => {
    const rejected = [
      "find . | xargs rm",
      "find . | sh -c 'cat'",
      "find . | tee /tmp/out",
      "find . -name '*.ts' | sort -o outfile",
      "find . | uniq input output",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowBashFindInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects dangerous find flags", () => {
    const rejected = [
      "find . -exec rm {} \\;",
      "find . -execdir cat {} \\;",
      "find . -ok rm {} \\;",
      "find . -okdir rm {} \\;",
      "find . -delete",
      "find . -name '*.log' -delete",
      "find . -fls /tmp/out",
      "find . -fprint /tmp/out",
      "find . -fprint0 /tmp/out",
      "find . -fprintf /tmp/out %p",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowBashFindInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects parentheses grouping", () => {
    const rejected = [
      "find . \\( -name '*.ts' -or -name '*.js' \\)",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowBashFindInProject.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through when no project root", async () => {
    const result = await allowBashFindInProject.handler(bash("find .", PROJECT, null));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-find commands", async () => {
    const result = await allowBashFindInProject.handler(bash("ls -la"));
    expect(result.verdict).toBe(NEXT);
  });
});
