import { describe, expect, it } from "bun:test";
import type { ToolCall } from "toolgate";
import {
  Op,
  parseShell,
  wordToString,
  getArgs,
  isSimpleCommand,
  getPipelineCommands,
  hasUnsafeNodes,
  getRedirects,
  safeBashCommand,
  safeBashCommandOrPipeline,
  isSafeFilter,
  findWriteRedirects,
  findTeeTargets,
  findGitSubcommands,
} from "../parse-bash-ast";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

// parseShell

describe("parseShell", () => {
  it("parses a simple command", async () => {
    const file = await parseShell("echo hello");
    expect(file).not.toBeNull();
    expect(file!.Type).toBe("File");
    expect(file!.Stmts).toHaveLength(1);
  });

  it("parses a pipeline", async () => {
    const file = await parseShell("echo hello | grep hello");
    expect(file).not.toBeNull();
    expect(file!.Stmts).toHaveLength(1);
    expect(file!.Stmts[0].Cmd!.Type).toBe("BinaryCmd");
  });

  it("returns null for invalid syntax", async () => {
    const file = await parseShell(";;;invalid");
    expect(file).toBeNull();
  });

  it("parses redirects", async () => {
    const file = await parseShell("echo hi > /tmp/out");
    expect(file).not.toBeNull();
    expect(file!.Stmts[0].Redirs).toBeDefined();
    expect(file!.Stmts[0].Redirs!.length).toBeGreaterThan(0);
  });

  it("parses command substitution", async () => {
    const file = await parseShell("echo $(whoami)");
    expect(file).not.toBeNull();
    expect(hasUnsafeNodes(file)).toBe(true);
  });
});

// wordToString

describe("wordToString", () => {
  it("returns value for Lit", async () => {
    const file = await parseShell("hello");
    const word = (file!.Stmts[0].Cmd as any).Args[0];
    expect(wordToString(word)).toBe("hello");
  });

  it("returns value for SglQuoted", async () => {
    const file = await parseShell("echo 'world'");
    const word = (file!.Stmts[0].Cmd as any).Args[1];
    expect(wordToString(word)).toBe("world");
  });

  it("returns value for DblQuoted with single Lit", async () => {
    const file = await parseShell('echo "simple"');
    const word = (file!.Stmts[0].Cmd as any).Args[1];
    expect(wordToString(word)).toBe("simple");
  });

  it("returns null for word containing $()", async () => {
    const file = await parseShell('echo "hello $(world)"');
    const word = (file!.Stmts[0].Cmd as any).Args[1];
    expect(wordToString(word)).toBeNull();
  });
});

// getArgs

describe("getArgs", () => {
  it("returns args for simple command", async () => {
    const file = await parseShell("git status --short");
    expect(getArgs(file!.Stmts[0])).toEqual(["git", "status", "--short"]);
  });

  it("returns null for BinaryCmd", async () => {
    const file = await parseShell("echo a && echo b");
    expect(getArgs(file!.Stmts[0])).toBeNull();
  });

  it("returns null for args with substitution", async () => {
    const file = await parseShell("echo $(whoami)");
    expect(getArgs(file!.Stmts[0])).toBeNull();
  });
});

// isSimpleCommand

describe("isSimpleCommand", () => {
  it("true for simple command", async () => {
    const file = await parseShell("git status");
    expect(isSimpleCommand(file!)).toBe(true);
  });

  it("true with 2>&1", async () => {
    const file = await parseShell("bun test 2>&1");
    expect(isSimpleCommand(file!)).toBe(true);
  });

  it("true with 2>/dev/null", async () => {
    const file = await parseShell("cmd 2>/dev/null");
    expect(isSimpleCommand(file!)).toBe(true);
  });

  it("false for pipeline", async () => {
    const file = await parseShell("echo hi | grep hi");
    expect(isSimpleCommand(file!)).toBe(false);
  });

  it("false for multi-stmt", async () => {
    const file = await parseShell("echo a; echo b");
    expect(isSimpleCommand(file!)).toBe(false);
  });

  it("false for bare > redirect", async () => {
    const file = await parseShell("echo hi > /tmp/out");
    expect(isSimpleCommand(file!)).toBe(false);
  });
});

// getPipelineCommands

describe("getPipelineCommands", () => {
  it("flattens 3-segment pipe", async () => {
    const file = await parseShell("echo hi | grep hi | head -5");
    const cmds = getPipelineCommands(file!.Stmts[0]);
    expect(cmds).not.toBeNull();
    expect(cmds!).toHaveLength(3);
    expect(getArgs(cmds![0])).toEqual(["echo", "hi"]);
    expect(getArgs(cmds![1])).toEqual(["grep", "hi"]);
    expect(getArgs(cmds![2])).toEqual(["head", "-5"]);
  });

  it("returns single-element for simple cmd", async () => {
    const file = await parseShell("echo hello");
    const cmds = getPipelineCommands(file!.Stmts[0]);
    expect(cmds).toHaveLength(1);
  });

  it("returns null for && chain", async () => {
    const file = await parseShell("echo a && echo b");
    const cmds = getPipelineCommands(file!.Stmts[0]);
    expect(cmds).toBeNull();
  });
});

// hasUnsafeNodes

describe("hasUnsafeNodes", () => {
  it("false for literals", async () => {
    const file = await parseShell("echo hello world");
    expect(hasUnsafeNodes(file)).toBe(false);
  });

  it("true for CmdSubst", async () => {
    const file = await parseShell("echo $(whoami)");
    expect(hasUnsafeNodes(file)).toBe(true);
  });

  it("true for backticks", async () => {
    const file = await parseShell("echo `whoami`");
    expect(hasUnsafeNodes(file)).toBe(true);
  });

  it("true for ParamExp", async () => {
    const file = await parseShell("echo $HOME");
    expect(hasUnsafeNodes(file)).toBe(true);
  });

  it("false for single-quoted special chars", async () => {
    const file = await parseShell("echo '$HOME'");
    expect(hasUnsafeNodes(file)).toBe(false);
  });
});

// getRedirects

describe("getRedirects", () => {
  it("finds file redirect with target and fd", async () => {
    const file = await parseShell("echo hi 2>/dev/null");
    const redirs = getRedirects(file!);
    expect(redirs).toHaveLength(1);
    expect(redirs[0].target).toBe("/dev/null");
    expect(redirs[0].fd).toBe("2");
    expect(redirs[0].op).toBe(Op.RdrOut);
  });

  it("finds fd dup redirect", async () => {
    const file = await parseShell("cmd 2>&1");
    const redirs = getRedirects(file!);
    expect(redirs).toHaveLength(1);
    expect(redirs[0].op).toBe(Op.DplOut);
    expect(redirs[0].fd).toBe("2");
    expect(redirs[0].target).toBe("1");
  });
});

// safeBashCommand

describe("safeBashCommand", () => {
  it("simple command returns args", async () => {
    expect(await safeBashCommand(bash("git status"))).toEqual([
      "git",
      "status",
    ]);
  });

  it("strips 2>&1", async () => {
    expect(await safeBashCommand(bash("bun test foo 2>&1"))).toEqual([
      "bun",
      "test",
      "foo",
    ]);
  });

  it("strips 2>/dev/null", async () => {
    expect(await safeBashCommand(bash("cmd 2>/dev/null"))).toEqual(["cmd"]);
  });

  it("null for pipeline", async () => {
    expect(await safeBashCommand(bash("echo hi | grep hi"))).toBeNull();
  });

  it("null for && chain", async () => {
    expect(await safeBashCommand(bash("echo a && echo b"))).toBeNull();
  });

  it("null for command substitution", async () => {
    expect(await safeBashCommand(bash("echo $(whoami)"))).toBeNull();
  });

  it("null for non-Bash tool", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/foo" },
      context: { cwd: "/tmp", env: {}, projectRoot: null },
    };
    expect(await safeBashCommand(call)).toBeNull();
  });

  it("null for multiline commands", async () => {
    expect(await safeBashCommand(bash("echo a\necho b"))).toBeNull();
  });

  it("null for file redirect", async () => {
    expect(await safeBashCommand(bash("echo hi > /tmp/out"))).toBeNull();
  });

  it("null for semicolons", async () => {
    expect(await safeBashCommand(bash("echo a; echo b"))).toBeNull();
  });

  it("null for background", async () => {
    expect(await safeBashCommand(bash("sleep 10 &"))).toBeNull();
  });

  it("handles single-quoted args", async () => {
    expect(await safeBashCommand(bash("grep 'hello world' file"))).toEqual([
      "grep",
      "hello world",
      "file",
    ]);
  });
});

// safeBashCommandOrPipeline

describe("safeBashCommandOrPipeline", () => {
  it("returns args for simple command", async () => {
    expect(await safeBashCommandOrPipeline(bash("git status"))).toEqual([
      "git",
      "status",
    ]);
  });

  it("returns first segment for piped-to-safe-filter", async () => {
    expect(
      await safeBashCommandOrPipeline(bash("bun test 2>&1 | tail -5")),
    ).toEqual(["bun", "test"]);
  });

  it("returns first segment with multiple safe filters", async () => {
    expect(
      await safeBashCommandOrPipeline(
        bash("git log --oneline | grep fix | head -10"),
      ),
    ).toEqual(["git", "log", "--oneline"]);
  });

  it("null for unsafe pipe target", async () => {
    expect(
      await safeBashCommandOrPipeline(bash("bun test | xargs rm")),
    ).toBeNull();
  });

  it("null for && chains", async () => {
    expect(
      await safeBashCommandOrPipeline(bash("echo a && echo b")),
    ).toBeNull();
  });
});

// isSafeFilter

describe("isSafeFilter", () => {
  describe("returns true for safe filters", () => {
    const safe: string[][] = [
      ["grep", "-i", "pattern"],
      ["egrep", "foo|bar"],
      ["fgrep", "literal"],
      ["head", "-10"],
      ["tail", "-5"],
      ["wc", "-l"],
      ["cat"],
      ["tr", "a-z", "A-Z"],
      ["cut", "-d:", "-f1"],
      ["sort"],
      ["sort", "-r"],
      ["uniq"],
      ["uniq", "-c"],
      ["file", "foo.txt"],
      ["stat", "foo.txt"],
      ["du", "-sh", "."],
      ["diff", "a.txt", "b.txt"],
    ];

    for (const tokens of safe) {
      it(`safe: ${tokens.join(" ")}`, () => {
        expect(isSafeFilter(tokens)).toBe(true);
      });
    }
  });

  describe("returns false for unsafe commands", () => {
    const unsafe: string[][] = [
      ["xargs", "rm"],
      ["rm", "-rf", "/"],
      ["tee", "/tmp/out"],
      ["bash", "-c", "evil"],
      ["sort", "-o", "outfile"],
      ["sort", "--output", "file"],
      ["uniq", "input", "output"],
    ];

    for (const tokens of unsafe) {
      it(`unsafe: ${tokens.join(" ")}`, () => {
        expect(isSafeFilter(tokens)).toBe(false);
      });
    }
  });

  it("false for empty", () => {
    expect(isSafeFilter([])).toBe(false);
  });
});

// findWriteRedirects

describe("findWriteRedirects", () => {
  it("finds > target", async () => {
    const file = await parseShell("echo hi > /tmp/out");
    const writes = findWriteRedirects(file!);
    expect(writes).toHaveLength(1);
    expect(writes[0].target).toBe("/tmp/out");
  });

  it("finds >> target", async () => {
    const file = await parseShell("echo hi >> /tmp/log");
    const writes = findWriteRedirects(file!);
    expect(writes).toHaveLength(1);
    expect(writes[0].target).toBe("/tmp/log");
  });

  it("ignores 2>/dev/null", async () => {
    const file = await parseShell("cmd 2>/dev/null");
    const writes = findWriteRedirects(file!);
    expect(writes).toHaveLength(0);
  });

  it("ignores 2>&1", async () => {
    const file = await parseShell("cmd 2>&1");
    const writes = findWriteRedirects(file!);
    expect(writes).toHaveLength(0);
  });

  it("finds redirects inside && chains", async () => {
    const file = await parseShell("echo a > /tmp/a && echo b > /tmp/b");
    const writes = findWriteRedirects(file!);
    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.target)).toContain("/tmp/a");
    expect(writes.map((w) => w.target)).toContain("/tmp/b");
  });

  it("finds redirects across newlines, filtering safe targets", async () => {
    const file = await parseShell("echo a > /tmp/a\necho b 2>/dev/null");
    const writes = findWriteRedirects(file!);
    expect(writes).toHaveLength(1);
    expect(writes[0].target).toBe("/tmp/a");
  });
});

// findTeeTargets

describe("findTeeTargets", () => {
  it("finds tee file args", async () => {
    const file = await parseShell("echo hi | tee /tmp/out");
    const targets = findTeeTargets(file!);
    expect(targets).toEqual(["/tmp/out"]);
  });

  it("skips flags", async () => {
    const file = await parseShell("echo hi | tee -a /tmp/out");
    const targets = findTeeTargets(file!);
    expect(targets).toEqual(["/tmp/out"]);
  });

  it("empty when no tee", async () => {
    const file = await parseShell("echo hi | grep hi");
    const targets = findTeeTargets(file!);
    expect(targets).toEqual([]);
  });
});

// findGitSubcommands

describe("findGitSubcommands", () => {
  it("finds add and commit in && chain", async () => {
    const file = await parseShell("git add . && git commit -m 'msg'");
    const subs = findGitSubcommands(file!);
    expect(subs).toEqual(["add", "commit"]);
  });

  it("finds across newlines", async () => {
    const file = await parseShell("git add .\ngit commit -m 'msg'");
    const subs = findGitSubcommands(file!);
    expect(subs).toEqual(["add", "commit"]);
  });

  it("simple command", async () => {
    const file = await parseShell("git status");
    const subs = findGitSubcommands(file!);
    expect(subs).toEqual(["status"]);
  });

  it("no false positive on quoted strings", async () => {
    const file = await parseShell("echo 'git push'");
    const subs = findGitSubcommands(file!);
    expect(subs).toEqual([]);
  });
});
