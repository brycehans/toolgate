import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowNpxSafe from "../allow-npx-safe";

const makeCall = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  tool,
  args,
  context: { cwd: "/tmp", env: {}, projectRoot: "/tmp" },
});

describe("allow-npx-safe", () => {
  it("allows npx playwright test", async () => {
    const result = await allowNpxSafe.handler(makeCall("Bash", { command: "npx playwright test" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows npx vitest", async () => {
    const result = await allowNpxSafe.handler(makeCall("Bash", { command: "npx vitest" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows npx next build", async () => {
    const result = await allowNpxSafe.handler(makeCall("Bash", { command: "npx next build" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows npx cdk synth", async () => {
    const result = await allowNpxSafe.handler(makeCall("Bash", { command: "npx cdk synth" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows npx cdk diff", async () => {
    const result = await allowNpxSafe.handler(makeCall("Bash", { command: "npx cdk diff" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows npx cdk list", async () => {
    const result = await allowNpxSafe.handler(makeCall("Bash", { command: "npx cdk list" }));
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through npx cdk deploy", async () => {
    const result = await allowNpxSafe.handler(makeCall("Bash", { command: "npx cdk deploy" }));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through npx cdk deploy with stack name", async () => {
    const result = await allowNpxSafe.handler(makeCall("Bash", { command: "npx cdk deploy MyStack" }));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through npx cdk destroy", async () => {
    const result = await allowNpxSafe.handler(makeCall("Bash", { command: "npx cdk destroy" }));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through unknown npx packages", async () => {
    const result = await allowNpxSafe.handler(makeCall("Bash", { command: "npx some-unknown-pkg" }));
    expect(result.verdict).toBe(NEXT);
  });

  it("allows mcp__playwright__ tools", async () => {
    const result = await allowNpxSafe.handler(makeCall("mcp__playwright__browser_snapshot"));
    expect(result.verdict).toBe(ALLOW);
  });

  it("passes through non-Bash tools", async () => {
    const result = await allowNpxSafe.handler(makeCall("Read", { file_path: "/tmp/test" }));
    expect(result.verdict).toBe(NEXT);
  });
});
