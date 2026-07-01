import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGitWorktree from "../allow-git-worktree";

const run = adaptHandler(allowGitWorktree.action!, allowGitWorktree.handler as any);

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-git-worktree", () => {
  describe("allows worktree CRUD subcommands", () => {
    const allowed = [
      "git worktree add .claude/worktrees/feature-branch -b feature-branch",
      "git worktree add .claude/worktrees/my-fix -b my-fix origin/develop",
      "git worktree add ../worktree-dir",
      "git worktree list",
      "git worktree list --porcelain",
      "git worktree move .claude/worktrees/old-name .claude/worktrees/new-name",
      "git worktree remove .claude/worktrees/feature-branch",
      "git worktree remove --force .claude/worktrees/feature-branch",
      "git worktree prune",
      "git worktree prune --dry-run",
      "git worktree lock .claude/worktrees/feature-branch",
      "git worktree lock --reason 'in use' .claude/worktrees/feature-branch",
      "git worktree unlock .claude/worktrees/feature-branch",
      "git worktree repair",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("real-world patterns from logs", () => {
    it("allows: git worktree add with branch and remote tracking", async () => {
      const result = await run(
        bash("git worktree add .claude/worktrees/remove-poc -b remove-poc origin/develop"),
      );
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows: git worktree remove", async () => {
      const result = await run(
        bash("git worktree remove .claude/worktrees/remove-poc"),
      );
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("passes through non-worktree commands", () => {
    const passThrough = [
      "git status",
      "git log --oneline",
      "git branch -a",
      "ls -la",
    ];

    for (const cmd of passThrough) {
      it(`next: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
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
