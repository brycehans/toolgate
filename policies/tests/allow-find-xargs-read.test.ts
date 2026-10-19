import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowFindXargsRead from "../allow-find-xargs-read";
import denyFindXargsWithoutNull from "../deny-find-xargs-without-null";

const allow = adaptHandler(allowFindXargsRead.action!, allowFindXargsRead.handler as any);
const deny = adaptHandler(denyFindXargsWithoutNull.action!, denyFindXargsWithoutNull.handler as any);

const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot, additionalDirs: [] },
  };
}

describe("allow-find-xargs-read", () => {
  describe("allows NUL-delimited find | xargs <read-only cmd> in the project", () => {
    const allowed = [
      "find . -type f -name '*.ts' -print0 | xargs -0 wc -l",
      "find src -name '*.md' -print0 | xargs -0 cat",
      "find . -name '*.ts' -print0 | xargs --null grep -n TODO",
      // A signed value like `-mtime -1` reads as an unknown flag to the shared
      // find check (as in allow-bash-find), so an unsigned one is used here.
      "find . -maxdepth 2 -type f -mtime 1 -print0 | xargs -0 stat",
      "find . -name .git -prune -o -type f -print0 | xargs -0 -n 50 -P 4 wc -l",
      "find . -type f -print0 | xargs -0 -r -n1 head -5",
      "find . -type f -name '*.log' -print0 | xargs -0 du -h | sort -h | tail -5",
      "find -name '*.ts' -print0 | xargs -0 file",
      "find /home/user/project/src -print0 | xargs -0 grep -l -e foo -e bar",
    ];
    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        expect((await allow(bash(cmd))).verdict).toBe(ALLOW);
      });
    }
  });

  describe("refuses roots or fixed operands outside the project", () => {
    const refused = [
      "find /etc -type f -print0 | xargs -0 cat",
      "find ~ -name '*.pem' -print0 | xargs -0 cat",
      "find ../other -print0 | xargs -0 cat",
      // grep -f reads its patterns from a file.
      "find . -print0 | xargs -0 grep -f /etc/shadow",
      "find . -print0 | xargs -0 file -m /etc/magic",
    ];
    for (const cmd of refused) {
      it(`passes through: ${cmd}`, async () => {
        expect((await allow(bash(cmd))).verdict).toBe(NEXT);
      });
    }

    it("passes through when cwd is outside the project and no root is given", async () => {
      expect((await allow(bash("find -print0 | xargs -0 cat", "/etc"))).verdict).toBe(NEXT);
    });

    it("passes through without a project root", async () => {
      expect((await allow(bash("find . -print0 | xargs -0 cat", PROJECT, null))).verdict).toBe(NEXT);
    });
  });

  describe("refuses dot-prefixed roots", () => {
    for (const cmd of [
      "find .git -type f -print0 | xargs -0 cat",
      "find ./.secrets -print0 | xargs -0 cat",
    ]) {
      it(`passes through: ${cmd}`, async () => {
        expect((await allow(bash(cmd))).verdict).toBe(NEXT);
      });
    }
  });

  describe("refuses anything that runs, writes or follows links", () => {
    const refused = [
      // find actions that execute, delete or write.
      "find . -exec cat {} + -print0 | xargs -0 wc -l",
      "find . -delete -print0 | xargs -0 wc -l",
      "find . -fprint0 /tmp/x | xargs -0 wc -l",
      // -follow can walk out of the project through a symlinked directory.
      "find . -follow -print0 | xargs -0 cat",
      // xargs options outside the batching set.
      "find . -print0 | xargs -0 -I {} cat {}",
      "find . -print0 | xargs -0 -a list.txt cat",
      "find . -print0 | xargs -0 -n many cat",
      // Commands outside the read-only set.
      "find . -print0 | xargs -0 rm",
      "find . -print0 | xargs -0 sed -i s/a/b/",
      "find . -print0 | xargs -0 sh -c 'cat \"$@\"'",
      "find . -print0 | xargs -0",
      // A trailing segment that is not a safe filter.
      "find . -print0 | xargs -0 cat | sh",
      // Redirects and substitution.
      "find . -print0 | xargs -0 cat > out.txt",
      "find $(pwd) -print0 | xargs -0 cat",
      // Mixed delimiters.
      "find . -print -print0 | xargs -0 cat",
    ];
    for (const cmd of refused) {
      it(`passes through: ${cmd}`, async () => {
        expect((await allow(bash(cmd))).verdict).toBe(NEXT);
      });
    }
  });

  describe("does not allow the whitespace-split form", () => {
    for (const cmd of [
      "find . -name '*.ts' | xargs wc -l",
      "find . -name '*.ts' -print0 | xargs wc -l",
      "find . -name '*.ts' | xargs -0 wc -l",
    ]) {
      it(`passes through: ${cmd}`, async () => {
        expect((await allow(bash(cmd))).verdict).toBe(NEXT);
      });
    }
  });
});

describe("deny-find-xargs-without-null", () => {
  function suggestion(reason: string): string {
    return reason.split("\n").find((l) => l.startsWith("  "))!.trim();
  }

  const steered: Array<[string, string]> = [
    ["find . -name '*.ts' | xargs wc -l", "find . -name '*.ts' -print0 | xargs -0 wc -l"],
    ["find . -name '*.ts' -print | xargs grep -n TODO", "find . -name '*.ts' -print0 | xargs -0 grep -n TODO"],
    ["find src -type f -print0 | xargs cat", "find src -type f -print0 | xargs -0 cat"],
    ["find . -type f | xargs -0 cat", "find . -type f -print0 | xargs -0 cat"],
    ["find . -type f | xargs du -h | sort -h", "find . -type f -print0 | xargs -0 du -h | sort -h"],
    ["find . -name \"it's.md\" | xargs cat", "find . -name 'it'\\''s.md' -print0 | xargs -0 cat"],
  ];
  for (const [cmd, fixed] of steered) {
    it(`steers: ${cmd}`, async () => {
      const result = await deny(bash(cmd));
      expect(result.verdict).toBe(DENY);
      expect(suggestion((result as { reason: string }).reason)).toBe(fixed);
    });
  }

  it("suggests a command the allow policy accepts", async () => {
    const result = await deny(bash("find . -name '*.ts' | xargs wc -l"));
    const fixed = suggestion((result as { reason: string }).reason);
    expect((await allow(bash(fixed))).verdict).toBe(ALLOW);
  });

  describe("leaves shapes it can't fix to a prompt", () => {
    for (const cmd of [
      "find . -print0 | xargs -0 cat",           // already allowed
      "find /etc | xargs cat",                    // out of scope even with -0
      "find . | xargs rm",                        // not a read-only command
      "find . -ls | xargs cat",                   // -ls output isn't file names
      "find . -follow | xargs cat",
      "ls | xargs cat",
    ]) {
      it(`passes through: ${cmd}`, async () => {
        expect((await deny(bash(cmd))).verdict).toBe(NEXT);
      });
    }
  });
});
