import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowReadOnlyGitBranch from "../allow-git-branch";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-git-branch", () => {
  describe("allows read-only git branch commands", () => {
    const allowed = [
      "git branch",
      "git branch --show-current",
      "git branch -l",
      "git branch --list",
      "git branch -a",
      "git branch --all",
      "git branch -r",
      "git branch --remotes",
      "git branch -v",
      "git branch -vv",
      "git branch --verbose",
      "git branch --merged",
      "git branch --merged main",
      "git branch --no-merged",
      "git branch --contains abc123",
      "git branch --sort=-committerdate",
      "git branch --format='%(refname:short)'",
      "git branch -a --sort=-committerdate",
      "git branch --list --contains HEAD",
      "git branch --points-at HEAD",
      "git branch --color=always",
      "git branch --no-color",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowReadOnlyGitBranch.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("allows piped through safe filters", () => {
    const allowed = [
      "git branch | grep feature",
      "git branch -a | head -5",
      "git branch --sort=-committerdate | head -10",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowReadOnlyGitBranch.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects mutation commands", () => {
    const rejected = [
      "git branch new-feature",
      "git branch -d old-branch",
      "git branch -D old-branch",
      "git branch --delete old-branch",
      "git branch -m old-name new-name",
      "git branch -M old-name new-name",
      "git branch --move old-name new-name",
      "git branch -c source copy",
      "git branch -C source copy",
      "git branch --copy source copy",
      "git branch --set-upstream-to=origin/main",
      "git branch -u origin/main",
      "git branch --unset-upstream",
      "git branch -f main HEAD~3",
      "git branch --force main HEAD~3",
      "git branch --edit-description",
      "git branch --track new-branch origin/main",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowReadOnlyGitBranch.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "git branch && rm -rf /",
      "git branch | bash -c evil",
      "git branch\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowReadOnlyGitBranch.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-git-branch commands", () => {
    const rejected = [
      "git status",
      "git log",
      "echo git branch",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowReadOnlyGitBranch.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });
});
