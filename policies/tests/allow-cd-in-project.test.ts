import { homedir } from "node:os";
import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowCdInProject from "../allow-cd-in-project";

const run = adaptHandler(allowCdInProject.action!, allowCdInProject.handler as any);

const HOME = homedir();
const PROJECT = `${HOME}/Dev/myproject`;

function bash(command: string, cwd = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-cd-in-project", () => {
  describe("allows cd to project paths", () => {
    const allowed = [
      { cmd: "cd src", desc: "relative subdir" },
      { cmd: "cd src/components", desc: "nested relative subdir" },
      { cmd: `cd ${PROJECT}`, desc: "absolute project root" },
      { cmd: `cd ${PROJECT}/src`, desc: "absolute project subdir" },
      { cmd: "cd .", desc: "current dir" },
      { cmd: "cd ..", desc: "parent still in project", cwd: `${PROJECT}/src` },
      { cmd: "cd ~/Dev/myproject/src", desc: "tilde path into project" },
      { cmd: "cd ~/Dev/myproject", desc: "tilde path to project root" },
    ];

    for (const { cmd, desc, cwd } of allowed) {
      it(`allows: ${cmd} (${desc})`, async () => {
        const result = await run(bash(cmd, cwd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("passes through cd outside project", () => {
    const passThrough = [
      { cmd: "cd /tmp", desc: "absolute outside project" },
      { cmd: "cd ~/Dev/other", desc: "tilde path outside project" },
      { cmd: "cd ..", desc: "parent leaves project", cwd: PROJECT },
    ];

    for (const { cmd, desc, cwd } of passThrough) {
      it(`next: ${cmd} (${desc})`, async () => {
        const result = await run(bash(cmd, cwd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("real-world patterns from logs", () => {
    const OTHER_PROJECT = `${HOME}/Dev/acme-app`;

    function bashFor(command: string, projectRoot: string, cwd = projectRoot): ToolCall {
      return {
        tool: "Bash",
        args: { command },
        context: { cwd, env: {}, projectRoot },
      };
    }

    it("allows: cd <absolute> to project root", async () => {
      const result = await run(bashFor(`cd ${OTHER_PROJECT}`, OTHER_PROJECT));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows: cd ~/Dev/<project> (tilde to project root)", async () => {
      const result = await run(bashFor("cd ~/Dev/acme-app", OTHER_PROJECT));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows: cd ~/Dev/<project>/.claude/worktrees/... (tilde to worktree inside project)", async () => {
      const result = await run(
        bashFor("cd ~/Dev/acme-app/.claude/worktrees/feature-branch", OTHER_PROJECT),
      );
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("passes through non-cd commands", () => {
    it("next: bare cd (goes home)", async () => {
      const result = await run(bash("cd"));
      expect(result.verdict).toBe(NEXT);
    });

    it("next: ls command", async () => {
      const result = await run(bash("ls -la"));
      expect(result.verdict).toBe(NEXT);
    });

    it("next: non-Bash tool", async () => {
      const call: ToolCall = {
        tool: "Read",
        args: { file_path: "/foo" },
        context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
      };
      const result = await run(call);
      expect(result.verdict).toBe(NEXT);
    });
  });
});
