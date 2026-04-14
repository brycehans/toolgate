import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowSearchInProject from "../allow-search-in-project";

const PROJECT = "/home/user/project";

function search(path: string | undefined, projectRoot: string | null = PROJECT): ToolCall {
  const args: Record<string, any> = { query: "foo" };
  if (path !== undefined) args.path = path;
  return {
    tool: "Search",
    args,
    context: { cwd: PROJECT, env: {}, projectRoot },
  };
}

describe("allow-search-in-project", () => {
  describe("allows search within project", () => {
    it("allows explicit path in project", async () => {
      const result = await allowSearchInProject.handler(search("/home/user/project/src"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows project root as path", async () => {
      const result = await allowSearchInProject.handler(search("/home/user/project"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows nested path", async () => {
      const result = await allowSearchInProject.handler(search("/home/user/project/a/b/c"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows when no path specified (defaults to cwd)", async () => {
      const result = await allowSearchInProject.handler(search(undefined));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows relative path within project", async () => {
      const result = await allowSearchInProject.handler(search("src/utils"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows relative path with dot prefix", async () => {
      const result = await allowSearchInProject.handler(search("./toolgate/policies"));
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("rejects search outside project", () => {
    it("rejects path outside project", async () => {
      const result = await allowSearchInProject.handler(search("/etc"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects sibling directory", async () => {
      const result = await allowSearchInProject.handler(search("/home/user/other-project"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects prefix trick", async () => {
      const result = await allowSearchInProject.handler(search("/home/user/project-evil/src"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("passes through when no project root", () => {
    it("with explicit path", async () => {
      const result = await allowSearchInProject.handler(search("/home/user/project/src", null));
      expect(result.verdict).toBe(NEXT);
    });

    it("with no path", async () => {
      const result = await allowSearchInProject.handler(search(undefined, null));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("rejects no-path search when cwd is outside project", () => {
    it("cwd outside project root", async () => {
      const call: ToolCall = {
        tool: "Search",
        args: { query: "foo" },
        context: { cwd: "/tmp", env: {}, projectRoot: PROJECT },
      };
      const result = await allowSearchInProject.handler(call);
      expect(result.verdict).toBe(NEXT);
    });
  });

  it("passes through non-Search tools", async () => {
    const call: ToolCall = {
      tool: "Bash",
      args: { command: "search foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await allowSearchInProject.handler(call);
    expect(result.verdict).toBe(NEXT);
  });

  describe("handles Glob tool name", () => {
    function glob(path: string | undefined, projectRoot: string | null = PROJECT): ToolCall {
      const args: Record<string, any> = { pattern: "*.ts" };
      if (path !== undefined) args.path = path;
      return {
        tool: "Glob",
        args,
        context: { cwd: PROJECT, env: {}, projectRoot },
      };
    }

    it("allows Glob with no path", async () => {
      const result = await allowSearchInProject.handler(glob(undefined));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows Glob with absolute path in project", async () => {
      const result = await allowSearchInProject.handler(glob("/home/user/project/src"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows Glob with relative path", async () => {
      const result = await allowSearchInProject.handler(glob("toolgate/policies"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("rejects Glob with path outside project", async () => {
      const result = await allowSearchInProject.handler(glob("/etc"));
      expect(result.verdict).toBe(NEXT);
    });
  });
});
