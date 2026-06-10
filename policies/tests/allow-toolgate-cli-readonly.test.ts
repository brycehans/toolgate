import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowToolgateCliReadOnly from "../allow-toolgate-cli-readonly";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project" },
  };
}

describe("allow-toolgate-cli-readonly", () => {
  describe("allows read-only subcommands", () => {
    const allowed = [
      "toolgate test Bash",
      `toolgate test Bash '{"command":"ls"}'`,
      `toolgate test Bash '{"command":"ls"}' --why`,
      "toolgate list",
      "toolgate logs",
      "toolgate audit",
      "toolgate audit --json",
      "toolgate disable --json",
      // Piped to a safe filter.
      "toolgate list | grep allow",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowToolgateCliReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects mutating subcommands", () => {
    const rejected = [
      "toolgate init",
      "toolgate init --project",
      "toolgate run",
      "toolgate suspend",
      "toolgate disable",
      "toolgate disable --local",
      "toolgate disable --shared",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowToolgateCliReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("ignores non-toolgate commands", async () => {
    const result = await allowToolgateCliReadOnly.handler(bash("gh pr view"));
    expect(result.verdict).toBe(NEXT);
  });
});
