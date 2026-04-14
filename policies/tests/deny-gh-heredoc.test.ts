import { describe, expect, it } from "bun:test";
import { DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import denyGhHeredoc from "../deny-gh-heredoc";

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("deny-gh-heredoc", () => {
  describe("denies gh commands with command substitution", () => {
    const denied = [
      `gh pr comment 123 --body "$(cat <<'EOF'\nsome content\nEOF\n)"`,
      `gh issue comment 456 --body "$(cat <<'EOF'\nbody text\nEOF\n)"`,
      `gh api repos/org/repo/issues/1/comments -X POST -f body="$(cat <<'EOF'\nhello\nEOF\n)"`,
      "gh pr comment 123 --body \"$(echo 'hello')\"",
      "gh pr create --title test --body \"`cat /tmp/body.md`\"",
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd.slice(0, 60)}...`, async () => {
        const result = await denyGhHeredoc.handler(bash(cmd));
        expect(result.verdict).toBe(DENY);
        expect(result.reason).toContain("--body-file");
      });
    }
  });

  describe("denies git commands with command substitution", () => {
    const denied = [
      `git commit -m "$(cat <<'EOF'\nfix: some message\n\nCo-Authored-By: Claude\nEOF\n)"`,
      "git commit -m \"$(echo 'hello')\"",
      "git tag -a v1.0 -m \"`cat /tmp/tag-msg.txt`\"",
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd.slice(0, 60)}...`, async () => {
        const result = await denyGhHeredoc.handler(bash(cmd));
        expect(result.verdict).toBe(DENY);
        expect(result.reason).toContain("git commit -F");
      });
    }
  });

  describe("allows safe gh commands through", () => {
    const allowed = [
      "gh pr view 123",
      "gh pr list",
      "gh issue list",
      "gh pr comment 123 --body-file /tmp/comment.md",
      "gh api repos/org/repo/pulls/1/comments",
      `gh pr comment 123 --body "simple inline text"`,
      "gh pr create --title test --body 'simple body'",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await denyGhHeredoc.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("allows safe git commands through", () => {
    const allowed = [
      "git commit -m 'simple message'",
      `git commit -m "simple message"`,
      "git commit -F /tmp/commit-msg.txt",
      "git tag -a v1.0 -m 'release'",
      "git push origin main",
    ];

    for (const cmd of allowed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await denyGhHeredoc.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("ignores non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/tmp/foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await denyGhHeredoc.handler(call);
    expect(result.verdict).toBe(NEXT);
  });

  it("ignores non-gh/git bash commands with substitution", async () => {
    const result = await denyGhHeredoc.handler(
      bash('echo "$(whoami)"'),
    );
    expect(result.verdict).toBe(NEXT);
  });
});
