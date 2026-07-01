import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { adaptHandler, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import redirectTrivialWranglerToRead from "../redirect-trivial-wrangler-to-read";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = adaptHandler(
  redirectTrivialWranglerToRead.action!,
  redirectTrivialWranglerToRead.handler as any,
);

let tmpDir: string;
let smallPath: string;
let bigPath: string;
let dirPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "toolgate-trivial-wrangler-"));
  smallPath = join(tmpDir, "small.json");
  bigPath = join(tmpDir, "big.json");
  dirPath = join(tmpDir, "subdir");
  writeFileSync(smallPath, '{"a":1,"b":2}'); // ~13 bytes
  writeFileSync(bigPath, "x".repeat(20 * 1024)); // 20 KB
  mkdirSync(dirPath);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("redirect-trivial-wrangler-to-read", () => {
  describe("denies trivial wranglers on small files (steer to Read)", () => {
    it("jq . <small>", async () => {
      const r = await run(bash(`jq . ${smallPath}`));
      expect(r.verdict).toBe(DENY);
      expect(r.reason).toMatch(/Read/);
    });
    it("jq <small> (no filter — defaults to identity)", async () => {
      const r = await run(bash(`jq ${smallPath}`));
      expect(r.verdict).toBe(DENY);
    });
    it("fx <small> .", async () => {
      const r = await run(bash(`fx ${smallPath} .`));
      expect(r.verdict).toBe(DENY);
    });
    it("fx <small> (no filter)", async () => {
      const r = await run(bash(`fx ${smallPath}`));
      expect(r.verdict).toBe(DENY);
    });
    it("yq . <small>", async () => {
      const r = await run(bash(`yq . ${smallPath}`));
      expect(r.verdict).toBe(DENY);
    });
    it("gron <small> (gron has no filter — always trivial)", async () => {
      const r = await run(bash(`gron ${smallPath}`));
      expect(r.verdict).toBe(DENY);
    });
    it("jq -r . <small> (flag does not change triviality)", async () => {
      const r = await run(bash(`jq -r . ${smallPath}`));
      expect(r.verdict).toBe(DENY);
    });
    it("fx <small> _ (underscore is also identity)", async () => {
      const r = await run(bash(`fx ${smallPath} _`));
      expect(r.verdict).toBe(DENY);
    });
  });

  describe("passes through real filters even on small files", () => {
    it("jq '.users' <small>", async () => {
      const r = await run(bash(`jq '.users' ${smallPath}`));
      expect(r.verdict).toBe(NEXT);
    });
    it("fx <small> '.a'", async () => {
      const r = await run(bash(`fx ${smallPath} '.a'`));
      expect(r.verdict).toBe(NEXT);
    });
    it("jq '.users[].name' <small>", async () => {
      const r = await run(bash(`jq '.users[].name' ${smallPath}`));
      expect(r.verdict).toBe(NEXT);
    });
  });

  describe("passes through when file is too big", () => {
    it("jq . <big> (20KB)", async () => {
      const r = await run(bash(`jq . ${bigPath}`));
      expect(r.verdict).toBe(NEXT);
    });
    it("gron <big>", async () => {
      const r = await run(bash(`gron ${bigPath}`));
      expect(r.verdict).toBe(NEXT);
    });
  });

  describe("passes through when file doesn't exist", () => {
    it("jq . <missing>", async () => {
      const r = await run(bash(`jq . ${join(tmpDir, "does-not-exist.json")}`));
      expect(r.verdict).toBe(NEXT);
    });
    it("jq . (no positional at all)", async () => {
      const r = await run(bash(`jq .`));
      expect(r.verdict).toBe(NEXT);
    });
  });

  describe("ignores directories (not regular files)", () => {
    it("jq . <dir>", async () => {
      const r = await run(bash(`jq . ${dirPath}`));
      expect(r.verdict).toBe(NEXT);
    });
  });

  describe("doesn't fire on piped invocations (handled by deny-wrangler-pipes)", () => {
    it("cat <small> | jq .", async () => {
      const r = await run(bash(`cat ${smallPath} | jq .`));
      expect(r.verdict).toBe(NEXT);
    });
  });

  describe("ignores non-wrangler commands", () => {
    it("cat <small>", async () => {
      const r = await run(bash(`cat ${smallPath}`));
      expect(r.verdict).toBe(NEXT);
    });
    it("ls <small>", async () => {
      const r = await run(bash(`ls ${smallPath}`));
      expect(r.verdict).toBe(NEXT);
    });
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: smallPath },
      context: { cwd: "/tmp", env: {}, projectRoot: null },
    };
    const r = await run(call);
    expect(r.verdict).toBe(NEXT);
  });
});
