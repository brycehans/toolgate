import { describe, expect, it } from "bun:test";
import { adaptHandler, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import denyGhIssuePrDelete from "../deny-gh-issue-pr-delete";

const run = adaptHandler(denyGhIssuePrDelete.action, denyGhIssuePrDelete.handler);

const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot: PROJECT },
  };
}

describe("deny-gh-issue-pr-delete", () => {
  describe("blocks delete", () => {
    for (const cmd of ["gh issue delete 5", "gh pr delete 3"]) {
      it(`denies: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }

    it("includes a reason", async () => {
      const result = await run(bash("gh pr delete 3"));
      expect(result.verdict).toBe(DENY);
      if (result.verdict === DENY) {
        expect(result.reason).toContain("delete is not allowed");
      }
    });
  });

  describe("non-delete commands fall through", () => {
    for (const cmd of [
      "gh issue create --title x",
      "gh pr edit 3",
      "gh repo delete foo",
      "git status",
    ]) {
      it(`falls through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });
});
