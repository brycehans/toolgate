import { describe, expect, it } from "bun:test";
import { adaptHandler, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import denyGitOutputFlag from "../deny-git-output-flag";

const run = adaptHandler(denyGitOutputFlag.action!, denyGitOutputFlag.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("deny-git-output-flag", () => {
  describe("denies --output on the git commands that accept it", () => {
    // Both spellings create and truncate the target. Neither is visible to
    // deny-writes-outside-project, so an unguarded path here is a write to
    // anywhere on disk.
    const denied = [
      "git show --output=/Users/me/.ssh/authorized_keys HEAD:package.json",
      "git show --output /Users/me/.ssh/authorized_keys HEAD:package.json",
      "git diff --output=/Users/me/.zshrc HEAD~1",
      "git log --output=/Users/me/.zshrc -p",
      "git   show   --output=/etc/hosts   HEAD",
      // Quoting and escaping are invisible to a text match but stripped by the
      // shell before git sees the flag.
      `git diff "--output=/Users/me/.zshrc" HEAD~1`,
      `git diff '--output' /Users/me/.zshrc HEAD~1`,
      String.raw`git diff \--output=/Users/me/.zshrc HEAD~1`,
      `git diff --out"put"=/Users/me/.zshrc HEAD~1`,
      // No constant value, but the literal prefix still names the flag.
      `git diff "--output=$HOME/.zshrc" HEAD~1`,
      // git reached through a wrapper or nested in a subshell.
      `env git diff --output=/Users/me/.zshrc`,
      `(git diff --output=/Users/me/.zshrc)`,
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }

    it("steers toward a shell redirect", async () => {
      const result = await run(bash("git show --output=/etc/hosts HEAD"));
      expect(result.verdict).toBe(DENY);
      expect((result as { reason: string }).reason).toContain(">");
    });
  });

  describe("leaves --output on other commands alone", () => {
    const allowed = [
      // The flag belongs to pandoc, and its target is a redirect away from git.
      "git log --oneline | pandoc --output=/tmp/out.pdf",
      "pandoc --output=/tmp/out.pdf README.md",
      "bun build ./src/index.ts --outdir=./dist",
      // --output-directory is a different flag and out of this policy's scope.
      "git show --output-encoding=utf-8 HEAD",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("leaves ordinary git commands alone", () => {
    const allowed = [
      "git show HEAD:package.json",
      "git show FETCH_HEAD:src/app.ts > ./tmp/app.ts",
      "git log --oneline -20",
      "git diff HEAD~1",
      // The flag's name in a message is just text, not an argument to git.
      `git commit -m "document the --output flag"`,
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: {},
      context: { cwd: "/tmp", env: {}, projectRoot: null },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
