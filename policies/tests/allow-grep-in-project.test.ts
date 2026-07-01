import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGrepInProject from "../allow-grep-in-project";

const run = adaptHandler(allowGrepInProject.action!, allowGrepInProject.handler as any);

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
      const result = await run(grep("/home/user/project/src"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows project root as path", async () => {
      const result = await run(grep("/home/user/project"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows nested path", async () => {
      const result = await run(grep("/home/user/project/a/b/c"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows when no path specified (defaults to cwd)", async () => {
      const result = await run(grep(undefined));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows relative path within project", async () => {
      const result = await run(grep("src/utils"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows relative path with dot prefix", async () => {
      const result = await run(grep("./toolgate/policies"));
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("rejects grep outside project", () => {
    it("rejects path outside project", async () => {
      const result = await run(grep("/etc"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects sibling directory", async () => {
      const result = await run(grep("/home/user/other-project"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects prefix trick", async () => {
      const result = await run(grep("/home/user/project-evil/src"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("passes through when no project root", () => {
    it("with explicit path", async () => {
      const result = await run(grep("/home/user/project/src", null));
      expect(result.verdict).toBe(NEXT);
    });

    it("with no path", async () => {
      const result = await run(grep(undefined, null));
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
      const result = await run(call);
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("allows grep in additionalDirs", () => {
    it("allows path in additional directory", async () => {
      const call: ToolCall = {
        tool: "Grep",
        args: { pattern: "foo", path: "/shared/lib/utils.ts" },
        context: { cwd: PROJECT, env: {}, projectRoot: PROJECT, additionalDirs: ["/shared/lib"] },
      };
      const result = await run(call);
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows additional directory root", async () => {
      const call: ToolCall = {
        tool: "Grep",
        args: { pattern: "foo", path: "/shared/lib" },
        context: { cwd: PROJECT, env: {}, projectRoot: PROJECT, additionalDirs: ["/shared/lib"] },
      };
      const result = await run(call);
      expect(result.verdict).toBe(ALLOW);
    });

    it("rejects path outside both project and additional dirs", async () => {
      const call: ToolCall = {
        tool: "Grep",
        args: { pattern: "foo", path: "/secret/data" },
        context: { cwd: PROJECT, env: {}, projectRoot: PROJECT, additionalDirs: ["/shared/lib"] },
      };
      const result = await run(call);
      expect(result.verdict).toBe(NEXT);
    });

    it("allows no-path grep when cwd is in additional dir", async () => {
      const call: ToolCall = {
        tool: "Grep",
        args: { pattern: "foo" },
        context: { cwd: "/shared/lib/src", env: {}, projectRoot: PROJECT, additionalDirs: ["/shared/lib"] },
      };
      const result = await run(call);
      expect(result.verdict).toBe(ALLOW);
    });
  });

  it("passes through non-Grep tools", async () => {
    const call: ToolCall = {
      tool: "Bash",
      args: { command: "grep foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
