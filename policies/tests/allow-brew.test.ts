import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "toolgate";
import allowBrew from "../allow-brew";

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-brew", () => {
  describe("auto-allows read-only commands", () => {
    const allowed = [
      "brew list",
      "brew ls",
      "brew info node",
      "brew search postgres",
      "brew deps node",
      "brew uses --installed node",
      "brew leaves",
      "brew outdated",
      "brew config",
      "brew doctor",
      "brew log node",
      "brew cat node",
      "brew desc node",
      "brew home node",
      "brew --version",
      "brew --prefix",
      "brew --cellar",
      "brew --caskroom",
      "brew --cache",
      "brew --repo",
      "brew formulae",
      "brew casks",
      "brew tap-info homebrew/core",
      "brew shellenv",
      "brew which-formula node",
      "brew list | grep node",
      "brew outdated | head -10",
      "brew info --json=v2 node",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowBrew.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("auto-allows safe services subcommands", () => {
    const allowed = [
      "brew services list",
      "brew services info postgres",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowBrew.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("requires approval for mutating commands", () => {
    const requireApproval = [
      "brew install node",
      "brew install --cask firefox",
      "brew uninstall node",
      "brew remove node",
      "brew rm node",
      "brew upgrade",
      "brew upgrade node",
      "brew autoremove",
      "brew cleanup",
      "brew cleanup -s",
      "brew untap homebrew/cask-fonts",
      "brew tap homebrew/cask-fonts",
      "brew link node",
      "brew link --overwrite node",
      "brew unlink node",
      "brew pin node",
      "brew unpin node",
      "brew edit node",
      "brew reinstall node",
      "brew services start postgres",
      "brew services stop postgres",
      "brew services restart postgres",
      "brew update",
      "brew migrate node",
    ];

    for (const cmd of requireApproval) {
      it(`requires approval: ${cmd}`, async () => {
        const result = await allowBrew.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("passes through non-brew commands", () => {
    it("ignores non-Bash tools", async () => {
      const call: ToolCall = {
        tool: "Read",
        args: { file_path: "/foo" },
        context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
      };
      const result = await allowBrew.handler(call);
      expect(result.verdict).toBe(NEXT);
    });

    it("ignores non-brew bash commands", async () => {
      const result = await allowBrew.handler(bash("git status"));
      expect(result.verdict).toBe(NEXT);
    });

    it("ignores compound commands", async () => {
      const result = await allowBrew.handler(bash("brew list && brew install node"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  it("falls through for bare brew with no subcommand", async () => {
    const result = await allowBrew.handler(bash("brew"));
    expect(result.verdict).toBe(NEXT);
  });
});
