import { describe, expect, it } from "bun:test";
import { ALLOW, DENY, NEXT, type ToolCall } from "toolgate";
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

    it("denies cat > with tilde path", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("cat > ~/other-project/foo.ts << 'EOF'\ncontent\nEOF"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies redirect to tilde path outside project", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("echo hi > ~/.bashrc"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies tee with tilde path", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("echo hi | tee ~/evil.txt"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies redirect with relative path outside project", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("echo hi > ../other-project/foo.ts"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("allows redirect with relative path inside project", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("echo hi > ./src/foo.ts"),
      );
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("denies write commands (cp/mv/install) outside project", () => {
    it("denies cp to /tmp", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("cp src/file.ts /tmp/file.ts"),
      );
      expect(result.verdict).toBe(DENY);
      expect(result.reason).toContain("Use ./tmp/ within your project instead");
    });

    it("denies cp in && chain to /tmp", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("cp /home/user/project/a /tmp/a-backup && cp /home/user/project/b /tmp/b-backup"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies mv to outside project", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("mv src/old.ts /home/user/other/old.ts"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies install to outside project", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("install -D src/bin /usr/local/bin/tool"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies cp to tilde path", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("cp src/file.ts ~/backup.ts"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("allows cp within project", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("cp src/a.ts src/b.ts"),
      );
      expect(result.verdict).toBe(NEXT);
    });

    it("allows cp to relative path in project", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("cp src/a.ts ./tmp/backup.ts"),
      );
      expect(result.verdict).toBe(NEXT);
    });

    it("passes through cp with no projectRoot", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("cp src/a.ts /tmp/a.ts", null),
      );
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("allows writes to additionalDirs", () => {
    it("allows Write to file in additional directory", async () => {
      const call: ToolCall = {
        tool: "Write",
        args: { file_path: "/shared/lib/utils.ts" },
        context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project", additionalDirs: ["/shared/lib"] },
      };
      const result = await denyWritesOutsideProject.handler(call);
      expect(result.verdict).toBe(NEXT);
    });

    it("denies Write outside both project and additional dirs", async () => {
      const call: ToolCall = {
        tool: "Write",
        args: { file_path: "/etc/passwd" },
        context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project", additionalDirs: ["/shared/lib"] },
      };
      const result = await denyWritesOutsideProject.handler(call);
      expect(result.verdict).toBe(DENY);
    });
  });

  describe("allows safe write targets", () => {
    it("allows redirect to /dev/null", async () => {
      const result = await denyWritesOutsideProject.handler(bash("cat foo 2>/dev/null"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows redirect to /dev/stderr", async () => {
      const result = await denyWritesOutsideProject.handler(bash("echo err > /dev/stderr"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows redirect to /dev/stdout", async () => {
      const result = await denyWritesOutsideProject.handler(bash("echo ok > /dev/stdout"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows tee to /dev/null", async () => {
      const result = await denyWritesOutsideProject.handler(bash("echo hi | tee /dev/null"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("denies when mix of safe and outside targets", async () => {
      const result = await denyWritesOutsideProject.handler(
        bash("echo hi > /dev/null\necho hi > /etc/passwd"),
      );
      expect(result.verdict).toBe(DENY);
    });
  });
});
