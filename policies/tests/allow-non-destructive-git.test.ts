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
    // A git global option sits in the subcommand slot, so failing to notice one
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
      "git format-patch -o /home/user/.ssh HEAD~1",
      "git clone https://example.com/x.git /home/user/.ssh/x",
      "git merge-file --union /home/user/.ssh/authorized_keys /dev/null /dev/null",
      "git archive --output=/home/user/.ssh/out.tar HEAD",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("refuses subcommands that discard uncommitted work", () => {
    // `checkout <path>` overwrites the working tree from the index. Naming the
    // path rather than `.` makes it no less destructive.
    const passed = [
      "git checkout -- src/app.ts",
      "git checkout --theirs -- src/app.ts",
      "git checkout 61c8bde -- src/app.ts",
      "git checkout -B main origin/main",
      "git checkout main",
      "git restore src/app.ts",
      "git restore --staged src/app.ts",
      "git merge-tree --write-tree main HEAD",
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
      "git branch -D feature",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("refuses read-only subcommands used to execute a program", () => {
    // `git grep -O<cmd>` hands every matched filename to <cmd> and runs it —
    // the same escape as `-c diff.external`, reachable without a TTY.
    const passed = [
      "git grep -O/usr/bin/whoami pattern",
      "git grep -O /usr/bin/whoami pattern",
      "git grep --open-files-in-pager=/usr/bin/whoami pattern",
      "git grep --open-files-in-pager /usr/bin/whoami pattern",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("refuses git remote used to rewrite remotes", () => {
    const passed = [
      "git remote add evil https://example.com/x.git",
      "git remote set-url origin https://example.com/x.git",
      "git remote remove origin",
      "git remote rename origin upstream",
      "git remote prune origin",
      "git remote set-head origin main",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("allows read-only inspection", () => {
    const allowed = [
      "git status",
      "git log --oneline -20",
      "git diff HEAD~1",
      "git show HEAD:package.json",
      "git grep -n pattern origin/master -- '*.ts'",
      "git ls-tree -r --name-only origin/master",
      "git ls-files src/",
      "git ls-remote --heads origin",
      "git for-each-ref --sort=-committerdate refs/remotes/origin/",
      "git show-ref --verify refs/heads/main",
      "git rev-parse --abbrev-ref HEAD",
      "git rev-list --count HEAD",
      "git merge-base main HEAD",
      "git describe --tags",
      "git blame src/app.ts",
      "git cat-file -p HEAD",
      "git shortlog -sn",
      "git diff-tree --no-commit-id --name-only -r HEAD",
      "git remote",
      "git remote -v",
      "git remote show origin",
      "git remote get-url origin",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  it("allows read-only inspection piped through a safe filter", async () => {
    const result = await run(bash("git ls-tree -r --name-only origin/master | head -40"));
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through a subcommand nobody enumerated", async () => {
    // The point of the inversion: an unknown subcommand prompts rather than
    // being waved through because nobody thought to deny it.
    const result = await run(bash("git notes add -m hello HEAD"));
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

  describe("refuses --output even without the deny layer", () => {
    for (const cmd of [
      "git diff --output=/Users/me/.zshrc HEAD~1",
      "git show --output /Users/me/.zshrc HEAD",
      "git log --output=/Users/me/.zshrc -p",
    ]) {
      it(`passes through: ${cmd}`, async () => {
        expect((await run(bash(cmd))).verdict).toBe(NEXT);
      });
    }
  });
});
