import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowMemoryCrud from "../allow-memory-crud";

const run = adaptHandler(allowMemoryCrud.action!, allowMemoryCrud.handler as any);

const HOME = homedir();
const PROJECT = "/home/user/project";
const MEMORY = `${HOME}/.claude/projects/-home-user-project/memory`;

function read(filePath: string): ToolCall {
  return {
    tool: "Read",
    args: { file_path: filePath },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

function write(filePath: string): ToolCall {
  return {
    tool: "Write",
    args: { file_path: filePath, content: "x" },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

function edit(filePath: string): ToolCall {
  return {
    tool: "Edit",
    args: { file_path: filePath, old_string: "a", new_string: "b" },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

function bash(command: string, cwd = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-memory-crud", () => {
  describe("file-tool CRUD on memory files", () => {
    const cases = [
      ["Read", () => read(`${MEMORY}/MEMORY.md`)],
      ["Read tilde", () => read(`~/.claude/projects/-home-user-project/memory/MEMORY.md`)],
      ["Write", () => write(`${MEMORY}/new-memory.md`)],
      ["Edit", () => edit(`${MEMORY}/MEMORY.md`)],
    ] as const;

    for (const [label, mk] of cases) {
      it(`allows ${label}`, async () => {
        const result = await run(mk());
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("paths outside memory dir pass through", () => {
    const cases = [
      ["sibling tool-results", () => read(`${HOME}/.claude/projects/-home-user-project/tool-results/foo.txt`)],
      ["project file", () => write(`${PROJECT}/src/index.ts`)],
      ["plain home file", () => read(`${HOME}/.bashrc`)],
      ["fake memory prefix", () => write(`${HOME}/.claude/projects/x/memory-but-not-really/foo.md`)],
      ["bare memory dir (no file)", () => read(`${MEMORY}`)],
      ["non-CRUD tool", () => ({
        tool: "Grep",
        args: { pattern: "foo", path: `${MEMORY}/MEMORY.md` },
        context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
      } as ToolCall)],
    ] as const;

    for (const [label, mk] of cases) {
      it(`passes through: ${label}`, async () => {
        const result = await run(mk());
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rm via Bash", () => {
    it("allows rm of a single memory file", async () => {
      const result = await run(bash(`rm ${MEMORY}/old.md`));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows rm with tilde path", async () => {
      const result = await run(bash("rm ~/.claude/projects/-home-user-project/memory/stale.md"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows rm of multiple memory files", async () => {
      const result = await run(bash(`rm ${MEMORY}/a.md ${MEMORY}/b.md`));
      expect(result.verdict).toBe(ALLOW);
    });

    it("rejects rm -rf even on memory dir", async () => {
      const result = await run(bash(`rm -rf ${MEMORY}`));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects rm -f on memory file", async () => {
      const result = await run(bash(`rm -f ${MEMORY}/x.md`));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects rm on non-memory path", async () => {
      const result = await run(bash(`rm ${PROJECT}/src/index.ts`));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects rm on mixed memory and non-memory", async () => {
      const result = await run(bash(`rm ${MEMORY}/a.md /etc/passwd`));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects mv (not in rm allow)", async () => {
      const result = await run(bash(`mv ${MEMORY}/a.md ${MEMORY}/b.md`));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects rm chained", async () => {
      const result = await run(bash(`rm ${MEMORY}/a.md && echo done`));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("ls via Bash", () => {
    it("allows ls of the memory dir", async () => {
      const result = await run(bash(`ls ${MEMORY}`));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows ls of the memory dir with trailing slash", async () => {
      const result = await run(bash(`ls ${MEMORY}/`));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows ls of a memory file", async () => {
      const result = await run(bash(`ls ${MEMORY}/MEMORY.md`));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows ls -la of the memory dir", async () => {
      const result = await run(bash(`ls -la ${MEMORY}`));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows ls with tilde path", async () => {
      const result = await run(bash("ls ~/.claude/projects/-home-user-project/memory"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("passes through ls with no path arg", async () => {
      const result = await run(bash("ls"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects ls of non-memory path", async () => {
      const result = await run(bash(`ls ${PROJECT}/src`));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects ls of mixed memory and non-memory paths", async () => {
      const result = await run(bash(`ls ${MEMORY} /etc`));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects ls chained", async () => {
      const result = await run(bash(`ls ${MEMORY} && echo done`));
      expect(result.verdict).toBe(NEXT);
    });
  });
});
