import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowNonDestructiveGit from "../allow-non-destructive-git";

const run = adaptHandler(allowNonDestructiveGit.action!, allowNonDestructiveGit.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project", additionalDirs: [] },
  };
}

describe("allow-non-destructive-git", () => {
  describe("refuses anything whose subcommand it cannot identify", () => {
    // This policy is a denylist — an unrecognised subcommand is ALLOWED. A git
    // global option sits in the subcommand slot, so failing to notice one
    // waves the real subcommand through unexamined.
    const passed = [
      "git --no-pager push --force origin main",
      "git --no-pager reset --hard HEAD~50",
      "git -c core.pager=whoami log -1",
      "git -c diff.external=/usr/bin/whoami diff HEAD~1",
      "git -c core.sshCommand=whoami fetch origin",
      "git --git-dir=/etc/other status",
      "git --work-tree=/ status",
      "git --exec-path=/tmp/evil status",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("refuses subcommands that write outside the repo", () => {
    const passed = [
      "git config --global user.email attacker@example.com",
      "git config --system core.pager evil",
      "git bundle create /home/user/.ssh/leak.bundle --all",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("still refuses the destructive subcommands it always did", () => {
    const passed = [
      "git push --force origin main",
      "git reset --hard HEAD~50",
      "git clean -fdx",
      "git rebase main",
      "git restore src/app.ts",
      "git branch -D feature",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("still allows ordinary read-only git", () => {
    const allowed = [
      "git status",
      "git log --oneline -20",
      "git diff HEAD~1",
      "git show HEAD:package.json",
      "git fetch origin",
      "git restore --staged src/app.ts",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
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
