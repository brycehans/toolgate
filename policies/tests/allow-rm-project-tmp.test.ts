import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowRmProjectTmp from "../allow-rm-project-tmp";

const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-rm-project-tmp", () => {
  describe("allows rm in project tmp/", () => {
    const allowed = [
      "rm tmp/commit-msg.txt",
      "rm tmp/gh-comment.md",
      "rm tmp/a.txt tmp/b.txt",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowRmProjectTmp.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  it("allows rm with absolute path in project tmp/", async () => {
    const result = await allowRmProjectTmp.handler(
      bash("rm /home/user/project/tmp/file.txt"),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  describe("requires approval for -r or -f flags in tmp/", () => {
    const flagged = [
      "rm -f tmp/pr-body.md",
      "rm -rf tmp/build-output",
      "rm -r tmp/nested/dir",
      "rm -fi tmp/file.txt",
    ];

    for (const cmd of flagged) {
      it(`requires approval: ${cmd}`, async () => {
        const result = await allowRmProjectTmp.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects rm outside project tmp/", () => {
    const rejected = [
      "rm /tmp/file.txt",
      "rm tmp/../secret.txt",
      "rm src/index.ts",
      "rm -rf /",
      "rm ~/.ssh/id_rsa",
      "rm file.txt",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowRmProjectTmp.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("rejects rm of the tmp/ directory itself", async () => {
    const result = await allowRmProjectTmp.handler(bash("rm -rf tmp"));
    expect(result.verdict).toBe(NEXT);
  });

  it("rejects rm with no file arguments", async () => {
    const result = await allowRmProjectTmp.handler(bash("rm -f"));
    expect(result.verdict).toBe(NEXT);
  });

  it("rejects if any path is outside tmp/", async () => {
    const result = await allowRmProjectTmp.handler(
      bash("rm tmp/ok.txt src/bad.ts"),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("ignores non-rm commands", async () => {
    const result = await allowRmProjectTmp.handler(bash("ls tmp/"));
    expect(result.verdict).toBe(NEXT);
  });

  it("ignores non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/tmp/foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await allowRmProjectTmp.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
