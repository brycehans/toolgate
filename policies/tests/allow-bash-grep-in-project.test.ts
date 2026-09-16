import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowBashGrepInProject from "../allow-bash-grep-in-project";

const run = adaptHandler(allowBashGrepInProject.action!, allowBashGrepInProject.handler as any);

const HOME = homedir();
const PROJECT = `${HOME}/some-project`;

function bash(command: string, cwd = PROJECT, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot },
  };
}

describe("allow-bash-grep-in-project", () => {
  describe("allows grep within the project", () => {
    const allowed = [
      "grep -r token src",
      "grep token src/index.ts",
      "rg token src",
      `grep -r token ${PROJECT}/src`,
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects grep into undeclared dot-prefixed directories", () => {
    const rejected = [
      "grep -r token .git",
      "grep -r token src/.cache",
      "grep AWS_SECRET .env",
      `grep -r token ${PROJECT}/.git`,
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }

    it("refuses an in-project dot-dir that containment alone would have passed", async () => {
      const result = await run(bash(`grep -r token ${PROJECT}/.env.local`));
      expect(result.verdict).toBe(NEXT);
    });
  });

  it("allows a declared safe dot-path that is also inside the project", async () => {
    const devRoot = `${HOME}/Dev`;
    const result = await run(
      bash(`grep -r token ${devRoot}/brain/.system`, devRoot, devRoot),
    );
    expect(result.verdict).toBe(ALLOW);
  });
});
