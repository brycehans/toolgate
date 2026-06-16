import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowRmdirProjectTmp from "../allow-rmdir-project-tmp";

const run = adaptHandler(allowRmdirProjectTmp.action!, allowRmdirProjectTmp.handler as any);

const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot },
  };
}

describe("allow-rmdir-project-tmp", () => {
  describe("allows rmdir of tmp/ and its subdirs", () => {
    const allowed = [
      "rmdir tmp",
      "rmdir ./tmp",
      `rmdir ${PROJECT}/tmp`,
      "rmdir tmp/foo",
      "rmdir -p tmp/foo/bar",
      "rmdir --ignore-fail-on-non-empty tmp",
      "rmdir tmp/a tmp/b",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects rmdir outside tmp", () => {
    const rejected = [
      "rmdir src",
      "rmdir ./dist",
      `rmdir ${PROJECT}`,
      "rmdir /etc/something",
      "rmdir tmp ../other",
      "rmdir tmp /tmp/escape",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects rmdir with no path args", () => {
    it("rejects bare rmdir", async () => {
      const result = await run(bash("rmdir"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects rmdir -p (no path)", async () => {
      const result = await run(bash("rmdir -p"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "rmdir tmp && rm -rf /",
      "rmdir tmp; echo pwned",
      "rmdir $(echo tmp)",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through when no project root", async () => {
    const result = await run(bash("rmdir tmp", PROJECT, null));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-rmdir commands", async () => {
    const result = await run(bash("rm tmp/foo"));
    expect(result.verdict).toBe(NEXT);
  });
});
