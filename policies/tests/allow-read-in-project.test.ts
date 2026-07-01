import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdirSync, symlinkSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowReadInProject from "../allow-read-in-project";

const run = adaptHandler(allowReadInProject.action!, allowReadInProject.handler as any);

const PROJECT = "/home/user/project";

function read(filePath: string): ToolCall {
  return {
    tool: "Read",
    args: { file_path: filePath },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-read-in-project", () => {
  it("allows reading a file in the project", async () => {
    const result = await run(
      read(`${PROJECT}/src/index.ts`),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows reading the project root itself", async () => {
    const result = await run(read(PROJECT));
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows relative paths within the project", async () => {
    const result = await run(
      read("docs/tickets/promotheus-tickets.md"),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows relative paths with dot prefix", async () => {
    const result = await run(read("./src/index.ts"));
    expect(result.verdict).toBe(ALLOW);
  });

  it("does not allow relative paths that escape the project", async () => {
    const result = await run(read("../../etc/passwd"));
    expect(result.verdict).toBe(NEXT);
  });

  it("does not allow reading outside the project", async () => {
    const result = await run(read("/etc/passwd"));
    expect(result.verdict).toBe(NEXT);
  });

  it("does not allow reading home directory files", async () => {
    const result = await run(
      read("~/.ssh/id_rsa"),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-Read tools", async () => {
    const call: ToolCall = {
      tool: "Bash",
      args: { command: "cat file.txt" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });

  describe("symlink resolution", () => {
    const tmp = join(tmpdir(), "toolgate-read-test-" + Date.now());
    const projectDir = join(tmp, "project");
    const outsideDir = join(tmp, "outside");

    beforeAll(() => {
      mkdirSync(join(projectDir, "docs"), { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(projectDir, "docs/real.md"), "safe");
      writeFileSync(join(outsideDir, "secret.txt"), "sensitive");
      // symlink inside project pointing outside
      symlinkSync(outsideDir, join(projectDir, "docs/escape"));
    });

    afterAll(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    function readReal(filePath: string): ToolCall {
      return {
        tool: "Read",
        args: { file_path: filePath },
        context: { cwd: projectDir, env: {}, projectRoot: projectDir },
      };
    }

    it("allows reading a real file in the project", async () => {
      const result = await run(
        readReal(join(projectDir, "docs/real.md")),
      );
      expect(result.verdict).toBe(ALLOW);
    });

    it("blocks symlink that escapes the project", async () => {
      const result = await run(
        readReal(join(projectDir, "docs/escape/secret.txt")),
      );
      expect(result.verdict).toBe(NEXT);
    });

    it("blocks relative path through symlink escape", async () => {
      const result = await run(
        readReal("docs/escape/secret.txt"),
      );
      expect(result.verdict).toBe(NEXT);
    });
  });
});
