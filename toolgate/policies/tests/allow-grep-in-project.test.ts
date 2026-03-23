import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowGrepInProject from "../allow-grep-in-project";

const PROJECT = "/home/user/project";

function grep(path: string | undefined, projectRoot: string | null = PROJECT): ToolCall {
  const args: Record<string, any> = { pattern: "foo" };
  if (path !== undefined) args.path = path;
  return {
    tool: "Grep",
    args,
    context: { cwd: PROJECT, env: {}, projectRoot },
  };
}

describe("allow-grep-in-project", () => {
  describe("allows grep within project", () => {
    it("allows explicit path in project", async () => {
      const result = await allowGrepInProject.handler(grep("/home/user/project/src"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows project root as path", async () => {
      const result = await allowGrepInProject.handler(grep("/home/user/project"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows nested path", async () => {
      const result = await allowGrepInProject.handler(grep("/home/user/project/a/b/c"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows when no path specified (defaults to cwd)", async () => {
      const result = await allowGrepInProject.handler(grep(undefined));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows relative path within project", async () => {
      const result = await allowGrepInProject.handler(grep("src/utils"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows relative path with dot prefix", async () => {
      const result = await allowGrepInProject.handler(grep("./toolgate/policies"));
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("rejects grep outside project", () => {
    it("rejects path outside project", async () => {
      const result = await allowGrepInProject.handler(grep("/etc"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects sibling directory", async () => {
      const result = await allowGrepInProject.handler(grep("/home/user/other-project"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects prefix trick", async () => {
      const result = await allowGrepInProject.handler(grep("/home/user/project-evil/src"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("passes through when no project root", () => {
    it("with explicit path", async () => {
      const result = await allowGrepInProject.handler(grep("/home/user/project/src", null));
      expect(result.verdict).toBe(NEXT);
    });

    it("with no path", async () => {
      const result = await allowGrepInProject.handler(grep(undefined, null));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("rejects no-path grep when cwd is outside project", () => {
    it("cwd outside project root", async () => {
      const call: ToolCall = {
        tool: "Grep",
        args: { pattern: "foo" },
        context: { cwd: "/tmp", env: {}, projectRoot: PROJECT },
      };
      const result = await allowGrepInProject.handler(call);
      expect(result.verdict).toBe(NEXT);
    });
  });

  it("passes through non-Grep tools", async () => {
    const call: ToolCall = {
      tool: "Bash",
      args: { command: "grep foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await allowGrepInProject.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
