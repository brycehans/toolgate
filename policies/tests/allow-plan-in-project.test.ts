import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowPlanInProject from "../allow-plan-in-project";

const run = adaptHandler(allowPlanInProject.action!, allowPlanInProject.handler as any);

const PROJECT = "/home/user/project";

function plan(path: string | undefined, projectRoot: string | null = PROJECT): ToolCall {
  const args: Record<string, any> = { task: "implement feature" };
  if (path !== undefined) args.path = path;
  return {
    tool: "Plan",
    args,
    context: { cwd: PROJECT, env: {}, projectRoot },
  };
}

describe("allow-plan-in-project", () => {
  describe("allows plan within project", () => {
    it("allows explicit path in project", async () => {
      const result = await run(plan("/home/user/project/src"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows project root as path", async () => {
      const result = await run(plan("/home/user/project"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows nested path", async () => {
      const result = await run(plan("/home/user/project/a/b/c"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows when no path specified (defaults to cwd)", async () => {
      const result = await run(plan(undefined));
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("rejects plan outside project", () => {
    it("rejects path outside project", async () => {
      const result = await run(plan("/etc"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects sibling directory", async () => {
      const result = await run(plan("/home/user/other-project"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects prefix trick", async () => {
      const result = await run(plan("/home/user/project-evil/src"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("passes through when no project root", () => {
    it("with explicit path", async () => {
      const result = await run(plan("/home/user/project/src", null));
      expect(result.verdict).toBe(NEXT);
    });

    it("with no path", async () => {
      const result = await run(plan(undefined, null));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("rejects no-path plan when cwd is outside project", () => {
    it("cwd outside project root", async () => {
      const call: ToolCall = {
        tool: "Plan",
        args: { task: "implement feature" },
        context: { cwd: "/tmp", env: {}, projectRoot: PROJECT },
      };
      const result = await run(call);
      expect(result.verdict).toBe(NEXT);
    });
  });

  it("passes through non-Plan tools", async () => {
    const call: ToolCall = {
      tool: "Bash",
      args: { command: "echo plan" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
