import { describe, expect, it } from "bun:test";
import { DENY, NEXT, type ToolCall } from "toolgate";
import denyWritesOutsideProject from "../deny-writes-outside-project";

function write(filePath: string, projectRoot: string | null = "/home/user/project"): ToolCall {
  return {
    tool: "Write",
    args: { file_path: filePath },
    context: { cwd: "/home/user/project", env: {}, projectRoot },
  };
}

function edit(filePath: string, projectRoot: string | null = "/home/user/project"): ToolCall {
  return {
    tool: "Edit",
    args: { file_path: filePath },
    context: { cwd: "/home/user/project", env: {}, projectRoot },
  };
}

function bash(command: string, projectRoot: string | null = "/home/user/project"): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/home/user/project", env: {}, projectRoot },
  };
}

describe("deny-writes-outside-project", () => {
  describe("allows writes within project root", () => {
    it("allows Write to file in project", async () => {
      const result = await denyWritesOutsideProject.handler(write("/home/user/project/src/foo.ts"));
      expect(result.verdict).toBe(NEXT);
    });

    it("allows Edit to file in project", async () => {
      const result = await denyWritesOutsideProject.handler(edit("/home/user/project/src/foo.ts"));
      expect(result.verdict).toBe(NEXT);
    });

    it("allows nested paths", async () => {
      const result = await denyWritesOutsideProject.handler(write("/home/user/project/a/b/c/d.ts"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("denies writes outside project root", () => {
    it("denies Write to /etc/passwd", async () => {
      const result = await denyWritesOutsideProject.handler(write("/etc/passwd"));
      expect(result.verdict).toBe(DENY);
    });

    it("denies Edit to home directory file", async () => {
      const result = await denyWritesOutsideProject.handler(edit("/home/user/.bashrc"));
      expect(result.verdict).toBe(DENY);
    });

    it("denies Write to sibling directory", async () => {
      const result = await denyWritesOutsideProject.handler(write("/home/user/other-project/foo.ts"));
      expect(result.verdict).toBe(DENY);
    });
  });

  describe("handles path traversal tricks", () => {
    it("denies path that is a prefix but not a subdirectory", async () => {
      // /home/user/project-evil is not inside /home/user/project
      const result = await denyWritesOutsideProject.handler(write("/home/user/project-evil/foo.ts"));
      expect(result.verdict).toBe(DENY);
    });
  });

  describe("passes through when no project root", () => {
    it("passes through Write with no projectRoot", async () => {
      const result = await denyWritesOutsideProject.handler(write("/etc/passwd", null));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("passes through non-write tools", () => {
    it("passes through Read", async () => {
      const call: ToolCall = {
        tool: "Read",
        args: { file_path: "/etc/passwd" },
        context: { cwd: "/tmp", env: {}, projectRoot: "/home/user/project" },
      };
      const result = await denyWritesOutsideProject.handler(call);
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("denies Bash redirects outside project", () => {
    it("denies cat > /outside/path", async () => {
      const result = await denyWritesOutsideProject.handler(bash("cat > /etc/passwd"));
      expect(result.verdict).toBe(DENY);
    });

    it("denies cat >> /outside/path (append)", async () => {
      const result = await denyWritesOutsideProject.handler(bash("cat >> /home/user/.bashrc"));
      expect(result.verdict).toBe(DENY);
    });

    it("denies heredoc redirect outside project", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("cat > /home/user/.claude/plans/evil.md << 'EOF'\nsome content\nEOF"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies mkdir -p && cat > /outside/path", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("mkdir -p /tmp/foo && cat > /tmp/foo/bar.md"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies tee writing outside project", async () => {
      const result = await denyWritesOutsideProject.handler(bash("echo hi | tee /etc/evil"));
      expect(result.verdict).toBe(DENY);
    });

    it("allows redirect inside project", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("echo hello > /home/user/project/output.txt"),
      );
      expect(result.verdict).toBe(NEXT);
    });

    it("allows Bash with no redirects", async () => {
      const result = await denyWritesOutsideProject.handler(bash("echo hello"));
      expect(result.verdict).toBe(NEXT);
    });

    it("allows Bash with no projectRoot", async () => {
      const result = await denyWritesOutsideProject.handler(bash("cat > /etc/passwd", null));
      expect(result.verdict).toBe(NEXT);
    });

    it("denies redirect to sibling project directory", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("echo x > /home/user/project-evil/foo.ts"),
      );
      expect(result.verdict).toBe(DENY);
    });
  });
});
