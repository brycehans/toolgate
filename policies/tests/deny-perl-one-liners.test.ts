import { describe, expect, it } from "bun:test";
import { adaptHandler, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import denyPerlOneLiners from "../deny-perl-one-liners";

const run = adaptHandler(denyPerlOneLiners.action!, denyPerlOneLiners.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("deny-perl-one-liners", () => {
  describe("denies inline perl scripts with steering message", () => {
    const cases = [
      "perl -e 'print 1'",
      "perl -ne 'print if /foo/'",
      "perl -pe 's/foo/bar/'",
      "perl -E 'say \"hi\"'",
      "perl -ane 'print $F[0]'",
      "perl -nle 'print'",
      "perl -ple 's/x/y/'",
      "perl -pae 'print'",
      "cat foo | perl -ne 'print'",
      "perl -ne 'print' | sort",
      "echo hi && perl -e 'print'",
      "perl -ne 'extract'; perl -pe 'modify'",
    ];
    for (const cmd of cases) {
      it(`denies: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(DENY);
        expect(result.reason).toMatch(/rg|sd|sed|choose|htmlq|xq/);
      });
    }
  });

  describe("passes through perl invocations without inline scripts", () => {
    const cases = [
      "perl script.pl",
      "perl -d script.pl",
      "perl --version",
      "perl -w script.pl",
      "perl -Mstrict script.pl",
      "perl -I/path/to/lib script.pl",
    ];
    for (const cmd of cases) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("does not affect non-perl commands", () => {
    const cases = [
      "echo hello",
      "ls -la",
      "rg -oP 'pattern' --replace '$1'",
      "sd find replace",
      "cat foo | sed 's/x/y/'",
    ];
    for (const cmd of cases) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/foo" },
      context: { cwd: "/tmp", env: {}, projectRoot: null },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
