import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowFindInProject from "../allow-find-in-project";

const PROJECT = "/home/user/project";

function find(path: string | undefined, projectRoot: string | null = PROJECT): ToolCall {
  const args: Record<string, any> = { pattern: "*.ts" };
  if (path !== undefined) args.path = path;
  return {
    tool: "Find",
    args,
    context: { cwd: PROJECT, env: {}, projectRoot },
  };
}

describe("allow-find-in-project", () => {
  describe("allows find within project", () => {
    it("allows explicit path in project", async () => {
      const result = await allowFindInProject.handler(find("/home/user/project/src"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows project root as path", async () => {
      const result = await allowFindInProject.handler(find("/home/user/project"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows nested path", async () => {
      const result = await allowFindInProject.handler(find("/home/user/project/a/b/c"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows when no path specified (defaults to cwd)", async () => {
      const result = await allowFindInProject.handler(find(undefined));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows relative path within project", async () => {
      const result = await allowFindInProject.handler(find("src/utils"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows relative path with dot prefix", async () => {
      const result = await allowFindInProject.handler(find("./toolgate/policies"));
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("rejects find outside project", () => {
    it("rejects path outside project", async () => {
      const result = await allowFindInProject.handler(find("/etc"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects sibling directory", async () => {
      const result = await allowFindInProject.handler(find("/home/user/other-project"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects prefix trick", async () => {
      const result = await allowFindInProject.handler(find("/home/user/project-evil/src"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("passes through when no project root", () => {
    it("with explicit path", async () => {
      const result = await allowFindInProject.handler(find("/home/user/project/src", null));
      expect(result.verdict).toBe(NEXT);
    });

    it("with no path", async () => {
      const result = await allowFindInProject.handler(find(undefined, null));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("rejects no-path find when cwd is outside project", () => {
    it("cwd outside project root", async () => {
      const call: ToolCall = {
        tool: "Find",
        args: { pattern: "*.ts" },
        context: { cwd: "/tmp", env: {}, projectRoot: PROJECT },
      };
      const result = await allowFindInProject.handler(call);
      expect(result.verdict).toBe(NEXT);
    });
  });

  it("passes through non-Find tools", async () => {
    const call: ToolCall = {
      tool: "Bash",
      args: { command: "find ." },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await allowFindInProject.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
