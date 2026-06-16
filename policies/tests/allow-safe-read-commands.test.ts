import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowSafeReadCommands from "../allow-safe-read-commands";

const run = adaptHandler(allowSafeReadCommands.action!, allowSafeReadCommands.handler as any);

const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot },
  };
}

describe("allow-safe-read-commands", () => {
  describe("allows read commands within project", () => {
    const allowed = [
      "cat README.md",
      "cat src/index.ts",
      `cat ${PROJECT}/src/index.ts`,
      "head -20 src/index.ts",
      "head -n 50 README.md",
      "tail -5 src/index.ts",
      "tail -f logs/dev.log",
      "wc -l src/index.ts",
      "wc -l src/index.ts src/utils.ts",
      "file src/index.ts",
      "stat src/index.ts",
      "du -sh src",
      "du -sh .",
      "diff src/a.ts src/b.ts",
      "cut -d: -f1 data.csv",
      "tr a-z A-Z",
      "sed -n '11,18p' src/index.ts",
      "sed -n '5p' README.md",
      "sed 's/foo/bar/' src/index.ts",
      "sed -e '/pattern/d' src/index.ts",
      "sed -n '/pattern/p' src/index.ts",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("allows read commands piped to safe filters", () => {
    const allowed = [
      "cat src/index.ts | head -20",
      "wc -l src/*.ts | sort -n",
      "cat README.md | grep TODO | wc -l",
      "du -sh src/* | sort -rh | head -5",
      "diff src/a.ts src/b.ts | head -50",
      "sed -n '1,10p' src/index.ts | grep TODO",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects read commands outside project", () => {
    const rejected = [
      "cat /etc/passwd",
      "cat /home/user/other/secret.txt",
      "head -20 /tmp/data",
      "wc -l /var/log/syslog",
      `cat ${PROJECT}-evil/src/index.ts`,
      "stat /etc/shadow",
      "file /usr/bin/ls",
      "du -sh /",
      "diff /etc/hosts /tmp/hosts",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects sed with in-place editing", () => {
    const rejected = [
      "sed -i 's/foo/bar/' src/index.ts",
      "sed -i'' 's/foo/bar/' src/index.ts",
      "sed -i.bak 's/foo/bar/' src/index.ts",
      "sed --in-place 's/foo/bar/' src/index.ts",
      "sed --in-place=.bak 's/foo/bar/' src/index.ts",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("allows jq within project", () => {
    const allowed = [
      `jq '.content.faqs[]' ${PROJECT}/data.json`,
      `jq '.foo | select(.bar)' ${PROJECT}/config.json`,
      `jq -r '.name' ${PROJECT}/package.json`,
      `jq --raw-output '.items[]' ${PROJECT}/data.json`,
      `jq -S '.' ${PROJECT}/data.json`,
      `jq --arg name foo '.[$name]' ${PROJECT}/data.json`,
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects jq with files outside project", () => {
    const rejected = [
      "jq '.' /etc/secrets.json",
      "jq '.keys' /home/user/other/data.json",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("allows jq with no file args (reads stdin) when cwd is in project", () => {
    it("allows jq with filter only", async () => {
      const result = await run(bash("jq '.'"));
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("allows fx within project", () => {
    const allowed = [
      `fx '.version' < ${PROJECT}/package.json`,
      "fx '.version' < package.json",
      "fx '.users[0].name' < data.json",
      `fx ${PROJECT}/data.json`,
      "fx 'this.fixtures.length' < e2e/fixtures.json",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects fx with files outside project", () => {
    const rejected = [
      "fx '.x' < /etc/passwd",
      "fx '.x' < /home/user/other/data.json",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("constrains `<` stdin-redirect targets to project", () => {
    const rejected = [
      "cat < /etc/passwd",
      "head < /etc/hosts",
      "wc -l < /etc/services",
      "jq '.' < /etc/secrets.json",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }

    const allowed = [
      "cat < README.md",
      "head < src/index.ts",
      "wc -l < src/index.ts",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects bare commands when cwd is outside project", () => {
    it("rejects cat with no args in /tmp", async () => {
      const result = await run(bash("cat", "/tmp"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects wc -l with no file in /tmp", async () => {
      const result = await run(bash("wc -l", "/tmp"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("rejects piped to unsafe commands", () => {
    const rejected = [
      "cat src/index.ts | xargs rm",
      "cat src/index.ts | tee /tmp/out",
      "cat src/index.ts | sh -c 'evil'",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "cat src/index.ts && rm -rf /",
      "cat src/index.ts; echo pwned",
      "cat src/index.ts\necho pwned",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through when no project root", async () => {
    const result = await run(bash("cat README.md", PROJECT, null));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/foo" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-safe commands", async () => {
    const result = await run(bash("rm -rf src"));
    expect(result.verdict).toBe(NEXT);
  });
});
