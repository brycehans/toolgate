import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowSuperpowersSkills from "../allow-superpowers-skills";

const PROJECT = "/home/user/project";

const makeCall = (tool: string, args: Record<string, unknown>): ToolCall => ({
  tool,
  args,
  context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
});

describe("allow-superpowers-skills", () => {
  it("allows superpowers:executing-plans", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Skill", { skill: "superpowers:executing-plans" }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows superpowers:subagent-driven-development", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Skill", { skill: "superpowers:subagent-driven-development" }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows superpowers:brainstorming", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Skill", { skill: "superpowers:brainstorming" }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows bare superpowers skill", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Skill", { skill: "superpowers" }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows superpowers skill with args", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Skill", { skill: "superpowers:write-plan", args: "some args" }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through non-superpowers skills", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Skill", { skill: "commit" }),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-Skill tools", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Bash", { command: "echo hello" }),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through when skill arg is not a string", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Skill", { skill: 123 }),
    );
    expect(result.verdict).toBe(NEXT);
  });

  // Agent tool tests
  it("allows Agent with superpowers:code-reviewer subagent_type", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Agent", { subagent_type: "superpowers:code-reviewer", prompt: "Review code" }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows Agent with superpowers:dispatching-parallel-agents subagent_type", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Agent", { subagent_type: "superpowers:dispatching-parallel-agents", prompt: "Run tasks" }),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through Agent with non-superpowers subagent_type", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Agent", { subagent_type: "general-purpose", prompt: "Do stuff" }),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through Agent with non-string subagent_type", async () => {
    const result = await allowSuperpowersSkills.handler(
      makeCall("Agent", { subagent_type: 42, prompt: "Do stuff" }),
    );
    expect(result.verdict).toBe(NEXT);
  });
});
