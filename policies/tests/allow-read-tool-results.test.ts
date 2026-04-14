import { describe, expect, it } from "bun:test";
import { homedir } from "os";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowReadToolResults from "../allow-read-tool-results";

const PROJECT = "/home/user/project";
const PROJECTS_DIR = `${homedir()}/.claude/projects`;
const SESSION_RESULTS = `${PROJECTS_DIR}/-Users-user-Dev-myapp/abc123-def456/tool-results`;

function read(filePath: string): ToolCall {
  return {
    tool: "Read",
    args: { file_path: filePath },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-read-tool-results", () => {
  it("allows reading a file in tool-results", async () => {
    const result = await allowReadToolResults.handler(
      read(`${SESSION_RESULTS}/bmxf3c4ew.txt`),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows tilde paths to tool-results", async () => {
    const result = await allowReadToolResults.handler(
      read("~/.claude/projects/-Users-user-Dev-myapp/abc123/tool-results/file.txt"),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("does not allow reading session root (not tool-results)", async () => {
    const result = await allowReadToolResults.handler(
      read(`${PROJECTS_DIR}/-Users-user-Dev-myapp/abc123/transcript.jsonl`),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("does not allow reading the projects dir itself", async () => {
    const result = await allowReadToolResults.handler(
      read(PROJECTS_DIR),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("does not allow reading other .claude directories", async () => {
    const result = await allowReadToolResults.handler(
      read(`${homedir()}/.claude/settings.json`),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-Read tools", async () => {
    const call: ToolCall = {
      tool: "Bash",
      args: { command: "cat ~/.claude/projects/foo/bar/tool-results/x.txt" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await allowReadToolResults.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
