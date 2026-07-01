import { describe, expect, it, mock, beforeEach } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";

// Mock Bun.spawn to simulate `git remote` output
let spawnOutput = "";
const originalSpawn = Bun.spawn;

function bash(command: string, projectRoot: string = "/tmp/local-repo"): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: projectRoot, env: {}, projectRoot },
  };
}

describe("allow-git-local-repo", () => {
  // We need to re-import the module for each describe block to reset the cache.
  // Instead, we'll test with different projectRoots to avoid cache hits.

  let run: ReturnType<typeof adaptHandler>;
  let callCount = 0;

  beforeEach(async () => {
    callCount++;
    // Clear module cache to reset remoteCache
    const modulePath = require.resolve("../allow-git-local-repo");
    delete require.cache[modulePath];
    const mod = await import("../allow-git-local-repo");
    const allowGitLocalRepo = mod.default;
    run = adaptHandler(allowGitLocalRepo.action!, allowGitLocalRepo.handler as any);

    // Default: simulate local repo (no remotes)
    spawnOutput = "";
    // @ts-ignore
    Bun.spawn = (...args: any[]) => {
      const cmd = args[0] as string[];
      if (cmd[0] === "git" && cmd[1] === "remote") {
        return {
          stdout: new Response(spawnOutput).body,
          stderr: new Response("").body,
          exited: Promise.resolve(0),
        };
      }
      return originalSpawn(...(args as Parameters<typeof originalSpawn>));
    };
  });

  describe("allows git commands in local repos", () => {
    const allowed = [
      "git add .",
      "git commit -m 'test'",
      "git log --oneline",
      "git diff",
      "git status",
      "git branch feature",
      "git branch -d feature",
      "git checkout -b new-branch",
      "git merge feature",
      "git rebase main",
      "git tag v1.0",
      "git stash",
      "git stash pop",
      "git stash apply",
      "git cherry-pick abc123",
      "git rev-parse HEAD",
      "git fetch",
      "git push",
      "git pull",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const root = `/tmp/local-${callCount++}`;
        const result = await run(bash(cmd, root));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("blocks destructive commands even in local repos", () => {
    const blocked = [
      "git reset --hard",
      "git reset --hard HEAD~1",
      "git checkout .",
      "git checkout -- .",
      "git restore src/file.ts",
      "git restore .",
      "git clean -f",
      "git clean -fd",
      "git clean -xfd",
      "git stash drop",
      "git stash clear",
      "git branch -D feature",
    ];

    for (const cmd of blocked) {
      it(`blocks: ${cmd}`, async () => {
        const root = `/tmp/local-blocked-${callCount++}`;
        const result = await run(bash(cmd, root));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("allows safe restore variants", () => {
    it("allows git restore --staged", async () => {
      const root = `/tmp/local-staged-${callCount++}`;
      const result = await run(bash("git restore --staged src/file.ts", root));
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("passes through for repos with remotes", () => {
    it("passes through when repo has origin", async () => {
      spawnOutput = "origin\n";
      const root = `/tmp/remote-${callCount++}`;
      const result = await run(bash("git commit -m 'test'", root));
      expect(result.verdict).toBe(NEXT);
    });

    it("passes through when repo has multiple remotes", async () => {
      spawnOutput = "origin\nupstream\n";
      const root = `/tmp/multi-remote-${callCount++}`;
      const result = await run(bash("git push", root));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("passes through for non-git commands", () => {
    it("passes through non-Bash tools", async () => {
      const call: ToolCall = {
        tool: "Read",
        args: {},
        context: { cwd: "/tmp", env: {}, projectRoot: "/tmp" },
      };
      const result = await run(call);
      expect(result.verdict).toBe(NEXT);
    });

    it("passes through non-git bash commands", async () => {
      const root = `/tmp/local-nongit-${callCount++}`;
      const result = await run(bash("ls -la", root));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("passes through when projectRoot is missing", () => {
    it("passes through with null projectRoot", async () => {
      const call: ToolCall = {
        tool: "Bash",
        args: { command: "git status" },
        context: { cwd: "/tmp", env: {}, projectRoot: null as any },
      };
      const result = await run(call);
      expect(result.verdict).toBe(NEXT);
    });
  });
});
