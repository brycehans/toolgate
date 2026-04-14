import { describe, expect, it } from "bun:test";
import { DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import redirectPlansToProject from "../redirect-plans-to-project";

const PROJECT = "/home/user/project";

function write(filePath: string, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Write",
    args: { file_path: filePath },
    context: { cwd: PROJECT, env: {}, projectRoot },
  };
}

function bash(command: string, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot },
  };
}

describe("redirect-plans-to-project", () => {
  describe("denies writes to global plans directory", () => {
    it("denies Write to ~/.claude/plans/", async () => {
      const result = await redirectPlansToProject.handler(
        write("/home/user/.claude/plans/my-plan.md"),
      );
      expect(result.verdict).toBe(DENY);
      expect((result as any).reason).toContain("docs/");
    });

    it("denies Edit to ~/.claude/plans/", async () => {
      const call: ToolCall = {
        tool: "Edit",
        args: { file_path: "/home/user/.claude/plans/my-plan.md" },
        context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
      };
      const result = await redirectPlansToProject.handler(call);
      expect(result.verdict).toBe(DENY);
    });

    it("denies Write to any user's .claude/plans", async () => {
      const result = await redirectPlansToProject.handler(
        write("/Users/bryce/.claude/plans/polymorphic-skipping-honey.md"),
      );
      expect(result.verdict).toBe(DENY);
    });
  });

  describe("denies Bash redirects to global plans directory", () => {
    it("denies cat > ~/.claude/plans/file", async () => {
      const result = await redirectPlansToProject.handler(
        bash("cat > /home/user/.claude/plans/plan.md"),
      );
      expect(result.verdict).toBe(DENY);
      expect((result as any).reason).toContain("docs/");
    });

    it("denies heredoc redirect to plans dir", async () => {
      const result = await redirectPlansToProject.handler(
        bash("cat > /home/user/.claude/plans/evil.md << 'EOF'\nplan content\nEOF"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies mkdir && cat > plans dir", async () => {
      const result = await redirectPlansToProject.handler(
        bash("mkdir -p /home/user/.claude/plans && cat > /home/user/.claude/plans/plan.md"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies tee to plans dir", async () => {
      const result = await redirectPlansToProject.handler(
        bash("echo content | tee /home/user/.claude/plans/plan.md"),
      );
      expect(result.verdict).toBe(DENY);
    });
  });

  describe("allows writes to project docs folder", () => {
    it("allows Write to project docs/", async () => {
      const result = await redirectPlansToProject.handler(
        write("/home/user/project/docs/plan.md"),
      );
      expect(result.verdict).toBe(NEXT);
    });

    it("allows Bash redirect to project docs/", async () => {
      const result = await redirectPlansToProject.handler(
        bash("cat > /home/user/project/docs/plan.md"),
      );
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("passes through unrelated tools and commands", () => {
    it("passes through Read", async () => {
      const call: ToolCall = {
        tool: "Read",
        args: { file_path: "/home/user/.claude/plans/plan.md" },
        context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
      };
      const result = await redirectPlansToProject.handler(call);
      expect(result.verdict).toBe(NEXT);
    });

    it("passes through Bash with no redirects", async () => {
      const result = await redirectPlansToProject.handler(bash("ls -la"));
      expect(result.verdict).toBe(NEXT);
    });

    it("passes through when no projectRoot", async () => {
      const result = await redirectPlansToProject.handler(
        write("/home/user/.claude/plans/plan.md", null),
      );
      expect(result.verdict).toBe(NEXT);
    });
  });
});
