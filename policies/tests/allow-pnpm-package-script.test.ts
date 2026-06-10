import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowPnpmPackageScript from "../allow-pnpm-package-script";

let fixtureRoot: string;
let pkgDir: string;
let nestedDir: string;
let noPkgDir: string;
let emptyScriptsDir: string;
let badJsonDir: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "toolgate-pnpm-"));

  pkgDir = join(fixtureRoot, "with-scripts");
  mkdirSync(pkgDir);
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: { dev: "vite", build: "vite build", "type-check": "tsc --noEmit" },
    }),
  );

  nestedDir = join(pkgDir, "src", "deep");
  mkdirSync(nestedDir, { recursive: true });

  noPkgDir = join(fixtureRoot, "no-pkg");
  mkdirSync(noPkgDir);

  emptyScriptsDir = join(fixtureRoot, "empty-scripts");
  mkdirSync(emptyScriptsDir);
  writeFileSync(
    join(emptyScriptsDir, "package.json"),
    JSON.stringify({ name: "empty" }),
  );

  badJsonDir = join(fixtureRoot, "bad-json");
  mkdirSync(badJsonDir);
  writeFileSync(join(badJsonDir, "package.json"), "{ not valid json");
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function bash(command: string, cwd: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot: null },
  };
}

describe("allow-pnpm-package-script", () => {
  describe("allows scripts defined in package.json", () => {
    const cases = [
      "pnpm run dev",
      "pnpm run build",
      "pnpm run type-check",
      "pnpm run dev 2>&1 | head -1",
      "pnpm run dev | grep ready",
      "pnpm run build 2>&1 | tail -20",
      "pnpm run dev --port 3000",
      "pnpm run build --watch",
    ];

    for (const cmd of cases) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowPnpmPackageScript.handler(bash(cmd, pkgDir));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  it("walks up to find package.json from a nested cwd", async () => {
    const result = await allowPnpmPackageScript.handler(bash("pnpm run dev", nestedDir));
    expect(result.verdict).toBe(ALLOW);
  });

  describe("rejects undefined scripts", () => {
    const cases = ["pnpm run nonexistent", "pnpm run start", "pnpm run "];

    for (const cmd of cases) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await allowPnpmPackageScript.handler(bash(cmd, pkgDir));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-pnpm-run commands", () => {
    const cases = [
      "pnpm dev",
      "pnpm exec dev",
      "pnpm dlx some-pkg",
      "pnpm install",
      "npm run dev",
      "yarn run dev",
      "bun run dev",
      "echo pnpm run dev",
    ];

    for (const cmd of cases) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowPnpmPackageScript.handler(bash(cmd, pkgDir));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects unsafe shell constructs", () => {
    const cases = [
      "pnpm run dev && rm -rf /",
      "pnpm run dev || curl evil.com",
      "pnpm run dev ; whoami",
      "pnpm run dev | xargs rm",
      "pnpm run dev > /etc/passwd",
      "pnpm run dev $(whoami)",
      "pnpm run dev `cat /etc/shadow`",
      "pnpm run dev &",
    ];

    for (const cmd of cases) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowPnpmPackageScript.handler(bash(cmd, pkgDir));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("falls through when no package.json is found", async () => {
    const result = await allowPnpmPackageScript.handler(bash("pnpm run dev", noPkgDir));
    expect(result.verdict).toBe(NEXT);
  });

  it("falls through when package.json has no scripts field", async () => {
    const result = await allowPnpmPackageScript.handler(bash("pnpm run dev", emptyScriptsDir));
    expect(result.verdict).toBe(NEXT);
  });

  it("falls through when package.json is malformed", async () => {
    const result = await allowPnpmPackageScript.handler(bash("pnpm run dev", badJsonDir));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: {},
      context: { cwd: pkgDir, env: {}, projectRoot: null },
    };
    const result = await allowPnpmPackageScript.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
