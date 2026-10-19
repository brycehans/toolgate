import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGitDirFlag from "../allow-git-dir-flag";

const run = adaptHandler(allowGitDirFlag.action!, allowGitDirFlag.handler as any);

function bash(command: string, additionalDirs: string[] = []): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: {
      cwd: "/home/user/project",
      env: {},
      projectRoot: "/home/user/project",
      additionalDirs,
    },
  };
}

describe("allow-git-dir-flag", () => {
  describe("allows redirected read-only inspection", () => {
    const allowed = [
      "git --git-dir=/home/user/project/sibling/.git grep -n pattern origin/main -- 'file.ts'",
      "git --git-dir /home/user/project/sibling/.git status",
      "git --work-tree=/home/user/project/sibling log --oneline -5",
      "git --git-dir=/home/user/project/sibling/.git --work-tree=/home/user/project/sibling diff HEAD~1",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  it("allows a redirected path that lives in additionalDirs rather than the project root", async () => {
    const result = await run(
      bash("git --git-dir=/home/user/other-repo/.git log", ["/home/user/other-repo"]),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  describe("refuses a redirect pointing outside project scope", () => {
    const passed = [
      "git --git-dir=/etc/other status",
      "git --work-tree=/ status",
      "git --git-dir=/home/user/project/sibling/.git --work-tree=/etc/other log",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("refuses a mutating or unsafe subcommand even with a valid redirect", () => {
    const passed = [
      "git --git-dir=/home/user/project/sibling/.git push --force origin main",
      "git --git-dir=/home/user/project/sibling/.git grep -O/usr/bin/whoami pattern",
      "git --git-dir=/home/user/project/sibling/.git diff --output=/Users/me/.zshrc",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("refuses an unrecognized global option in the redirect position", () => {
    const passed = [
      "git -c core.pager=whoami --git-dir=/home/user/project/sibling/.git status",
      "git --exec-path=/tmp/evil status",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("follows symlinks before the scope check", () => {
    let root: string;
    let project: string;
    let outside: string;

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "toolgate-gitdir-"));
      project = join(root, "project");
      outside = join(root, "outside");
      await mkdir(join(project, "sibling"), { recursive: true });
      await mkdir(outside);
      await symlink(outside, join(project, "escape"));
    });

    afterAll(async () => {
      await rm(root, { recursive: true, force: true });
    });

    function inProject(command: string): ToolCall {
      return {
        tool: "Bash",
        args: { command },
        context: { cwd: project, env: {}, projectRoot: project, additionalDirs: [] },
      };
    }

    it("refuses an in-project link that points outside", async () => {
      const result = await run(inProject("git --git-dir=./escape status"));
      expect(result.verdict).toBe(NEXT);
    });

    it("still allows a real in-project path when the project root is under a symlink", async () => {
      // tmpdir() is itself a symlink on macOS (/var -> /private/var).
      const result = await run(inProject("git --git-dir=./sibling status"));
      expect(result.verdict).toBe(ALLOW);
    });
  });

  it("passes through when no redirect flag is present", async () => {
    const result = await run(bash("git status"));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: {},
      context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project", additionalDirs: [] },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
