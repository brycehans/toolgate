import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGitFetch from "../allow-git-fetch";

const run = adaptHandler(allowGitFetch.action!, allowGitFetch.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project", additionalDirs: [] },
  };
}

describe("allow-git-fetch", () => {
  describe("allows fetching into remote-tracking refs", () => {
    const allowed = [
      "git fetch",
      "git fetch origin",
      "git fetch origin master",
      "git fetch origin master feature-branch",
      "git fetch origin refs/heads/master",
      "git fetch origin --quiet",
      "git fetch --all",
      "git fetch --prune origin",
      "git fetch --tags origin",
      "git fetch origin master 2>&1 | tail -20",
      // A '/' in a branch name past the remote is not a path.
      "git fetch origin feature/x",
      "git fetch --prune origin release/2.x",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("refuses refspecs, which force-update local branches", () => {
    // Verified: `git fetch origin +main:work` reports "(forced update)" and
    // destroys unpushed commits on `work` whenever it is not checked out.
    const passed = [
      "git fetch origin +main:work",
      "git fetch origin main:work",
      "git fetch origin +refs/heads/*:refs/heads/*",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("refuses fetching from an unnamed remote", () => {
    const passed = [
      "git fetch https://example.com/x.git",
      "git fetch git@example.com:org/repo.git",
      // Local paths carry no ':' but are just as unnamed.
      "git fetch ../other-repo",
      "git fetch ./vendor/lib main",
      "git fetch /Users/me/Dump share/toolgate-wip",
      "git fetch ~/Dump",
      "git fetch --quiet ../other-repo",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("refuses flags it does not recognise", () => {
    // `--upload-pack` and `--exec` name a program to run; the rest are refused
    // because an unlisted flag has not been argued safe, not because it is known bad.
    const passed = [
      "git fetch --upload-pack=/usr/bin/whoami origin",
      "git fetch --exec=/usr/bin/whoami origin",
      "git fetch --recurse-submodules origin",
      "git fetch --depth=1 origin",
    ];

    for (const cmd of passed) {
      it(`passes through: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through a git global flag in the subcommand slot", async () => {
    const result = await run(bash("git -c core.sshCommand=whoami fetch origin"));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through other git subcommands", async () => {
    const result = await run(bash("git push origin main"));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: {},
      context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project", additionalDirs: [] },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
