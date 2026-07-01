import { describe, expect, it } from "bun:test";
import { runPolicy, runPolicyWithTrace } from "../policy";
import { ALLOW, DENY, NEXT } from "../verdicts";
import type { Policy, ToolCall } from "../types";

const call: ToolCall = {
  tool: "Bash",
  args: { command: "echo hi" },
  context: { cwd: "/tmp", env: {}, projectRoot: "/tmp", additionalDirs: [] },
};

describe("runPolicy action ordering", () => {
  it("runs deny policies before allow policies regardless of array order", async () => {
    const log: string[] = [];

    const allowFirst: Policy = {
      name: "allow-first",
      description: "",
      action: "allow",
      handler: async () => { log.push("allow"); return true; },
    };
    const denySecond: Policy = {
      name: "deny-second",
      description: "",
      action: "deny",
      handler: async () => { log.push("deny"); }, // pass through
    };

    // allow is listed first, but deny should run first
    const result = await runPolicy([allowFirst, denySecond], call);
    expect(log).toEqual(["deny", "allow"]);
    expect(result.verdict).toBe(ALLOW);
  });

  it("deny policy short-circuits before allow policies run", async () => {
    const log: string[] = [];

    const allowPolicy: Policy = {
      name: "allow-it",
      description: "",
      action: "allow",
      handler: async () => { log.push("allow"); return true; },
    };
    const denyPolicy: Policy = {
      name: "deny-it",
      description: "",
      action: "deny",
      handler: async () => { log.push("deny"); return "blocked"; },
    };

    const result = await runPolicy([allowPolicy, denyPolicy], call);
    expect(log).toEqual(["deny"]);
    expect(result.verdict).toBe(DENY);
  });

  it("preserves relative order within same action type", async () => {
    const log: string[] = [];

    const deny1: Policy = {
      name: "deny-1",
      description: "",
      action: "deny",
      handler: async () => { log.push("deny-1"); },
    };
    const deny2: Policy = {
      name: "deny-2",
      description: "",
      action: "deny",
      handler: async () => { log.push("deny-2"); },
    };
    const allow1: Policy = {
      name: "allow-1",
      description: "",
      action: "allow",
      handler: async () => { log.push("allow-1"); return true; },
    };

    await runPolicy([allow1, deny2, deny1], call);
    // deny policies run first in original relative order, then allow
    expect(log).toEqual(["deny-2", "deny-1", "allow-1"]);
  });

  it("returns NEXT when no policy activates", async () => {
    const passThrough: Policy = {
      name: "noop",
      description: "",
      action: "allow",
      handler: async () => {},
    };

    const result = await runPolicy([passThrough], call);
    expect(result.verdict).toBe(NEXT);
  });

  it("trace returns correct policy name on deny", async () => {
    const denyPolicy: Policy = {
      name: "the-blocker",
      description: "blocks stuff",
      action: "deny",
      handler: async () => "nope",
    };

    const { result, name } = await runPolicyWithTrace([denyPolicy], call);
    expect(result.verdict).toBe(DENY);
    expect(name).toBe("the-blocker");
  });
});
