import { describe, expect, it } from "bun:test";
import { homedir } from "os";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowReadPluginCache from "../allow-read-plugin-cache";

const run = adaptHandler(allowReadPluginCache.action!, allowReadPluginCache.handler as any);

const PROJECT = "/home/user/project";
const CACHE = `${homedir()}/.claude/plugins/cache`;

function read(filePath: string): ToolCall {
  return {
    tool: "Read",
    args: { file_path: filePath },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-read-plugin-cache", () => {
  it("allows reading a file in the plugin cache", async () => {
    const result = await run(
      read(`${CACHE}/claude-plugins-official/manifest.json`),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows reading the cache directory itself", async () => {
    const result = await run(read(CACHE));
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows reading nested subdirectories", async () => {
    const result = await run(
      read(`${CACHE}/superpowers-marketplace/some/deep/file.ts`),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("allows tilde paths", async () => {
    const result = await run(
      read("~/.claude/plugins/cache/plugin/file.json"),
    );
    expect(result.verdict).toBe(ALLOW);
  });

  it("does not allow reading outside the cache", async () => {
    const result = await run(
      read(`${homedir()}/.claude/plugins/installed_plugins.json`),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("does not allow reading other .claude directories", async () => {
    const result = await run(
      read(`${homedir()}/.claude/settings.json`),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-Read tools", async () => {
    const call: ToolCall = {
      tool: "Bash",
      args: { command: "cat ~/.claude/plugins/cache/file" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
