import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowSkillCrud from "../allow-skill-crud";

const run = adaptHandler(allowSkillCrud.action!, allowSkillCrud.handler as any);

const PROJECT = "/home/user/project";
const HOME = process.env.HOME || "/home/user";

const makeCall = (
  tool: string,
  args: Record<string, unknown>,
  projectRoot = PROJECT,
): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot },
});

describe("allow-skill-crud", () => {
  // User-level skills (~/.claude/skills/)
  it("allows Read on ~/.claude/skills/ file", async () => {
    const result = await run(
      makeCall("Read", { file_path: `${HOME}/.claude/skills/my-skill.md` }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows Write on ~/.claude/skills/ file", async () => {
    const result = await run(
      makeCall("Write", {
        file_path: `${HOME}/.claude/skills/new-skill.md`,
        content: "# Skill",
      }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows Edit on ~/.claude/skills/ file", async () => {
    const result = await run(
      makeCall("Edit", {
        file_path: `${HOME}/.claude/skills/my-skill.md`,
        old_string: "old",
        new_string: "new",
      }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows Glob targeting ~/.claude/skills/", async () => {
    const result = await run(
      makeCall("Glob", {
        pattern: "*.md",
        path: `${HOME}/.claude/skills`,
      }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  // Project-level skills (<project>/.claude/skills/)
  it("allows Read on project .claude/skills/ file", async () => {
    const result = await run(
      makeCall("Read", {
        file_path: `${PROJECT}/.claude/skills/project-skill.md`,
      }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows Write on project .claude/skills/ file", async () => {
    const result = await run(
      makeCall("Write", {
        file_path: `${PROJECT}/.claude/skills/project-skill.md`,
        content: "# Skill",
      }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows Edit on project .claude/skills/ file", async () => {
    const result = await run(
      makeCall("Edit", {
        file_path: `${PROJECT}/.claude/skills/project-skill.md`,
        old_string: "old",
        new_string: "new",
      }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  // Pass-through cases
  it("passes through Read on non-skill path", async () => {
    const result = await run(
      makeCall("Read", { file_path: `${HOME}/.claude/settings.json` }),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through Write on non-skill .claude path", async () => {
    const result = await run(
      makeCall("Write", {
        file_path: `${HOME}/.claude/settings.json`,
        content: "{}",
      }),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through unrelated tools", async () => {
    const result = await run(
      makeCall("Bash", { command: "echo hello" }),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through when file_path is not a string", async () => {
    const result = await run(
      makeCall("Read", { file_path: 123 }),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through Glob without path targeting skills", async () => {
    const result = await run(
      makeCall("Glob", { pattern: "*.md", path: "/tmp" }),
    );
    expect(result.verdict).toBe(NEXT);
  });
});
