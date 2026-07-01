import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGhReadOnly from "../allow-gh-read-only";

const run = adaptHandler(allowGhReadOnly.action!, allowGhReadOnly.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project" },
  };
}

describe("allow-gh-read-only", () => {
  describe("allows read-only gh subcommands", () => {
    const allowed = [
      "gh issue view 123",
      "gh issue list",
      "gh pr view 42",
      "gh pr list",
      "gh pr diff 42",
      "gh pr checks 42",
      "gh run view 123",
      "gh run list",
      "gh run watch 123 --exit-status",
      "gh search issues 'bug'",
      "gh search prs 'fix'",
      "gh search repos 'toolgate'",
      "gh search code 'hello'",
      "gh search commits 'feat'",
      "gh repo view",
      "gh release view v1.0",
      "gh release list",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("allows read-only gh api calls", () => {
    const allowed = [
      "gh api repos/owner/repo/issues",
      "gh api repos/owner/repo/milestones/2",
      `gh api repos/owner/repo/milestones/2 --jq '".title"'`,
      "gh api repos/owner/repo/pulls --paginate",
      "gh api repos/owner/repo -H 'Accept: application/json'",
      "gh api /user",
      "gh api repos/owner/repo/milestones/2 -q '.title'",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects mutating gh api calls", () => {
    const rejected = [
      "gh api repos/owner/repo/issues -X POST",
      "gh api repos/owner/repo/issues --method POST",
      "gh api repos/owner/repo/issues -XPOST",
      "gh api repos/owner/repo/issues -XPATCH",
      "gh api repos/owner/repo/issues -f title='bug'",
      "gh api repos/owner/repo/issues -F title='bug'",
      "gh api repos/owner/repo/issues --field title='bug'",
      "gh api repos/owner/repo/issues --raw-field body='text'",
      "gh api repos/owner/repo/issues --input body.json",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects mutating gh subcommands", () => {
    const rejected = [
      "gh issue create",
      "gh issue close 123",
      "gh pr create",
      "gh pr merge 42",
      "gh repo create my-repo",
      "gh release create v2.0",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "gh issue view 123 && rm -rf /",
      "gh api /user | bash -c evil",
      "gh issue view 123\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through non-gh commands", async () => {
    const result = await run(bash("ls -la"));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/tmp/test" },
      context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project" },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
