import { describe, it, expect } from "bun:test";
import { isWithinProject, loadAdditionalDirs } from "./project-dirs";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("isWithinProject", () => {
  it("matches projectRoot exactly", () => {
    expect(isWithinProject("/proj", { projectRoot: "/proj" })).toBe(true);
  });

  it("matches paths inside projectRoot", () => {
    expect(isWithinProject("/proj/src/file.ts", { projectRoot: "/proj" })).toBe(true);
  });

  it("rejects paths outside projectRoot", () => {
    expect(isWithinProject("/other/file.ts", { projectRoot: "/proj" })).toBe(false);
  });

  it("rejects prefix-but-not-subdir matches", () => {
    expect(isWithinProject("/project-extra/file.ts", { projectRoot: "/project" })).toBe(false);
  });

  it("matches paths inside additionalDirs", () => {
    expect(
      isWithinProject("/docs/readme.md", {
        projectRoot: "/proj",
        additionalDirs: ["/docs"],
      }),
    ).toBe(true);
  });

  it("matches additionalDir root exactly", () => {
    expect(
      isWithinProject("/docs", {
        projectRoot: "/proj",
        additionalDirs: ["/docs"],
      }),
    ).toBe(true);
  });

  it("rejects paths outside both projectRoot and additionalDirs", () => {
    expect(
      isWithinProject("/secret/file.ts", {
        projectRoot: "/proj",
        additionalDirs: ["/docs"],
      }),
    ).toBe(false);
  });

  it("works with no additionalDirs (undefined)", () => {
    expect(isWithinProject("/proj/file.ts", { projectRoot: "/proj" })).toBe(true);
  });
});

describe("loadAdditionalDirs", () => {
  it("reads additionalDirectories from project settings", () => {
    const tmp = mkdtempSync(join(tmpdir(), "toolgate-test-"));
    const claudeDir = join(tmp, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        permissions: {
          additionalDirectories: ["../docs", "/absolute/path"],
        },
      }),
    );

    const dirs = loadAdditionalDirs(tmp);
    expect(dirs).toContain("/absolute/path");
    // ../docs relative to tmp resolves to sibling
    const resolvedDocs = join(tmp, "..", "docs");
    expect(dirs.some((d) => d.endsWith("/docs"))).toBe(true);
  });

  it("deduplicates across settings files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "toolgate-test-"));
    const claudeDir = join(tmp, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        permissions: { additionalDirectories: ["/shared"] },
      }),
    );
    writeFileSync(
      join(claudeDir, "settings.local.json"),
      JSON.stringify({
        permissions: { additionalDirectories: ["/shared", "/local-only"] },
      }),
    );

    const dirs = loadAdditionalDirs(tmp);
    expect(dirs.filter((d) => d === "/shared")).toHaveLength(1);
    expect(dirs).toContain("/local-only");
  });

  it("excludes projectRoot itself", () => {
    const tmp = mkdtempSync(join(tmpdir(), "toolgate-test-"));
    const claudeDir = join(tmp, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        permissions: { additionalDirectories: ["."] },
      }),
    );

    const dirs = loadAdditionalDirs(tmp);
    expect(dirs).not.toContain(tmp);
  });

  it("expands tilde paths", () => {
    const tmp = mkdtempSync(join(tmpdir(), "toolgate-test-"));
    const claudeDir = join(tmp, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        permissions: { additionalDirectories: ["~/Dev/KOSites"] },
      }),
    );

    const dirs = loadAdditionalDirs(tmp);
    const home = require("os").homedir();
    expect(dirs).toContain(join(home, "Dev/KOSites"));
    // Should NOT contain literal tilde
    expect(dirs.every((d) => !d.includes("~"))).toBe(true);
  });

  it("returns empty array when no settings exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "toolgate-test-"));
    const dirs = loadAdditionalDirs(tmp);
    expect(dirs).toEqual([]);
  });
});
