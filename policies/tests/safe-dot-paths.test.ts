import { afterEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { hasUnsafeDotSegment, setSafeDotPaths } from "../safe-dot-paths";

const HOME = homedir();
const CWD = `${HOME}/some-project`;

describe("safe-dot-paths", () => {
  afterEach(() => setSafeDotPaths([]));

  it("declares nothing safe by default", () => {
    expect(hasUnsafeDotSegment("~/.claude", CWD)).toBe(true);
    expect(hasUnsafeDotSegment(`${HOME}/.bun/install/global/node_modules`, CWD)).toBe(true);
  });

  it("leaves paths without a dot segment alone", () => {
    expect(hasUnsafeDotSegment("src/index.ts", CWD)).toBe(false);
  });

  it("allows a declared path and anything beneath it", () => {
    setSafeDotPaths(["~/.claude"]);
    expect(hasUnsafeDotSegment("~/.claude", CWD)).toBe(false);
    expect(hasUnsafeDotSegment(`${HOME}/.claude/plugins`, CWD)).toBe(false);
  });

  it("expands $HOME as well as ~", () => {
    setSafeDotPaths(["$HOME/.claude"]);
    expect(hasUnsafeDotSegment("~/.claude", CWD)).toBe(false);
  });

  it("matches on the resolved path, so a lookalike elsewhere stays unsafe", () => {
    setSafeDotPaths(["~/.claude"]);
    expect(hasUnsafeDotSegment(`${HOME}/Dev/.claude`, CWD)).toBe(true);
    expect(hasUnsafeDotSegment(`${HOME}/.claude-evil`, CWD)).toBe(true);
  });

  it("replaces rather than appends on each call", () => {
    setSafeDotPaths(["~/.claude"]);
    setSafeDotPaths(["~/.config"]);
    expect(hasUnsafeDotSegment("~/.claude", CWD)).toBe(true);
    expect(hasUnsafeDotSegment("~/.config", CWD)).toBe(false);
  });
});
