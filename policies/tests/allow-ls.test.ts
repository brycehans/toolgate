import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowLs from "../allow-ls";
import { setSafeDotPaths } from "../safe-dot-paths";

const run = adaptHandler(allowLs.action!, allowLs.handler as any);

const HOME = homedir();

// The built-in default is empty; configs declare these via `safeDotPaths`.
beforeAll(() => setSafeDotPaths(["~/.bun/install/global/node_modules", "~/.claude", "~/Dev/brain/.system"]));
afterAll(() => setSafeDotPaths([]));
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

  describe("allows ls into declared safe dot-paths", () => {
    const allowed = [
      `ls ${HOME}/.claude`,
      `ls ${HOME}/.claude/plugins/marketplaces`,
      "ls ~/.claude",
      `ls ${HOME}/.bun/install/global/node_modules/@brycehanscomb/toolgate/src`,
      `ls ${HOME}/Dev/brain/.system`,
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }

    it("does not let a lookalike path borrow the allowlist entry", async () => {
      const result = await run(bash(`ls ${HOME}/Dev/.claude`));
      expect(result.verdict).toBe(NEXT);
    });

    it("matches on the resolved path, not the string, so a relative route in is allowed", async () => {
      const result = await run(bash("ls ../.claude", `${HOME}/Dev`));
      expect(result.verdict).toBe(ALLOW);
    });

    it("keeps a sibling of an allowlisted dir out", async () => {
      const result = await run(bash(`ls ${HOME}/.bun/install/cache`));
      expect(result.verdict).toBe(NEXT);
    });
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

  describe("leaves multi-statement sequences to Deny chained commands", () => {
    // Even an all-ls sequence is denied before any allow runs, so this policy
    // only ever judges a single statement.
    const rejected = [
      "ls a; ls b",
      "ls src; ls /etc; ls /tmp",
      "ls a\nls b",
      "ls; echo pwned",
      "ls a; rm b",
      "ls a; ls .ssh",
      "ls a; cat /etc/passwd",
      "ls a; ls b | xargs rm",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
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
