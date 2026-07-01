import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { adaptHandler, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import { hashFile } from "../../src/pin";
import { executedScriptArg, pinnedScripts } from "../pinned-scripts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
let scriptHash: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "toolgate-pin-"));
  writeFileSync(join(root, "query.mjs"), "console.log('audited & safe')\n");
  writeFileSync(join(root, "db.mjs"), "console.log('db')\n");
  scriptHash = (await hashFile(join(root, "query.mjs")))!;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: root, env: {}, projectRoot: root, additionalDirs: [] },
  };
}

describe("executedScriptArg", () => {
  it("extracts the script an interpreter runs", () => {
    expect(executedScriptArg(["node", "query.mjs"])).toBe("query.mjs");
    expect(executedScriptArg(["node", "query.mjs", "funnel"])).toBe("query.mjs");
    expect(executedScriptArg(["python3", "-u", "foo.py"])).toBe("foo.py");
    expect(executedScriptArg(["/usr/bin/bun", "./x.ts"])).toBe("./x.ts");
  });

  it("extracts a directly-executed path", () => {
    expect(executedScriptArg(["./deploy.sh"])).toBe("./deploy.sh");
    expect(executedScriptArg(["scripts/run.sh"])).toBe("scripts/run.sh");
  });

  it("ignores scripts mentioned as data, not executed", () => {
    expect(executedScriptArg(["grep", "query.mjs"])).toBeNull();
    expect(executedScriptArg(["cat", "query.mjs"])).toBeNull();
    expect(executedScriptArg(["ls"])).toBeNull();
  });
});

describe("pinnedScripts", () => {
  it("passes through when the script matches its pin", async () => {
    const run = adaptHandler("deny", pinnedScripts({ "query.mjs": scriptHash }).handler);
    const result = await run(bash("node query.mjs funnel"));
    expect(result.verdict).toBe(NEXT);
  });

  it("denies when the script has drifted from its pin", async () => {
    const run = adaptHandler("deny", pinnedScripts({ "query.mjs": "deadbeef" }).handler);
    const result = await run(bash("node query.mjs funnel"));
    expect(result.verdict).toBe(DENY);
  });

  it("accepts a sha256: prefix on the pin", async () => {
    const run = adaptHandler("deny", pinnedScripts({ "query.mjs": `sha256:${scriptHash}` }).handler);
    const result = await run(bash("node query.mjs"));
    expect(result.verdict).toBe(NEXT);
  });

  it("denies when a pinned script is missing", async () => {
    const run = adaptHandler("deny", pinnedScripts({ "gone.mjs": scriptHash }).handler);
    const result = await run(bash("node gone.mjs"));
    expect(result.verdict).toBe(DENY);
  });

  it("catches a drifted pinned script anywhere in a compound command", async () => {
    const run = adaptHandler("deny", pinnedScripts({ "query.mjs": "deadbeef" }).handler);
    const result = await run(bash("echo hi && node query.mjs | head"));
    expect(result.verdict).toBe(DENY);
  });

  it("ignores an unpinned script", async () => {
    const run = adaptHandler("deny", pinnedScripts({ "query.mjs": scriptHash }).handler);
    const result = await run(bash("node db.mjs add"));
    expect(result.verdict).toBe(NEXT);
  });

  it("does not fire when the pinned name only appears as data", async () => {
    const run = adaptHandler("deny", pinnedScripts({ "query.mjs": "deadbeef" }).handler);
    const result = await run(bash("cat query.mjs"));
    expect(result.verdict).toBe(NEXT);
  });

  it("only pins matching action=deny paths, leaving non-Bash calls alone", async () => {
    const run = adaptHandler("deny", pinnedScripts({ "query.mjs": "deadbeef" }).handler);
    const result = await run({
      tool: "Read",
      args: { file_path: join(root, "query.mjs") },
      context: { cwd: root, env: {}, projectRoot: root, additionalDirs: [] },
    });
    expect(result.verdict).toBe(NEXT);
  });
});
