import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGhIssuePr from "../allow-gh-issue-pr";

const run = adaptHandler(allowGhIssuePr.action, allowGhIssuePr.handler);

const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-gh-issue-pr", () => {
  describe("allowed issue/pr actions", () => {
    const allowed = [
      "gh issue create --title x --body y",
      "gh pr create --fill",
      "gh issue comment 5 --body hi",
      "gh pr edit 3 --add-label bug",
      "gh issue close 7",
      "gh pr reopen 2",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("delete falls through (handled by deny policy)", () => {
    for (const cmd of ["gh issue delete 5", "gh pr delete 3"]) {
      it(`does not allow: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("unrelated gh subcommands fall through", () => {
    for (const cmd of ["gh repo view", "gh auth status", "git status"]) {
      it(`falls through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });
});
