import { describe, expect, it } from "bun:test";
import { homedir } from "os";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowEditInProject from "../allow-edit-in-project";

const PROJECT = "/home/user/project";
const HOME_PROJECT = `${homedir()}/myproject`;

function tool(name: string, file_path: string, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: name,
    args: { file_path },
    context: { cwd: PROJECT, env: {}, projectRoot },
  };
}

describe("allow-edit-in-project", () => {
  for (const toolName of ["Edit", "Write", "Update"]) {
    describe(`allows ${toolName} inside project`, () => {
      const allowed = [
        `${PROJECT}/src/index.ts`,
        `${PROJECT}/README.md`,
        `${PROJECT}/src/deep/nested/file.ts`,
      ];

      for (const path of allowed) {
        it(`allows: ${path}`, async () => {
          const result = await allowEditInProject.handler(tool(toolName, path));
          expect(result.verdict).toBe(ALLOW);
        });
      }
    });

    describe(`passes through ${toolName} outside project`, () => {
      const outside = [
        "/etc/hosts",
        "/home/user/.zshrc",
        "/home/user/other-project/file.ts",
        `${PROJECT}-evil/file.ts`,
      ];

      for (const path of outside) {
        it(`next: ${path}`, async () => {
          const result = await allowEditInProject.handler(tool(toolName, path));
          expect(result.verdict).toBe(NEXT);
        });
      }
    });
  }

  describe("passes through sensitive files (prompts user)", () => {
    const sensitive = [
      `${PROJECT}/.env`,
      `${PROJECT}/.env.local`,
      `${PROJECT}/.env.production`,
      `${PROJECT}/certs/server.pem`,
      `${PROJECT}/keys/private.key`,
      `${PROJECT}/auth/keystore.p12`,
      `${PROJECT}/credentials.json`,
      `${PROJECT}/config/secrets.yaml`,
      `${PROJECT}/package.json`,
      `${PROJECT}/.github/workflows/deploy.yml`,
      `${PROJECT}/.gitlab-ci.yml`,
      `${PROJECT}/.git/hooks/pre-commit`,
      `${PROJECT}/.husky/pre-push`,
      `${PROJECT}/.claude/settings.json`,
      `${PROJECT}/.claude/settings.local.json`,
      `${PROJECT}/toolgate.config.ts`,
    ];

    for (const path of sensitive) {
      it(`next: ${path}`, async () => {
        const result = await allowEditInProject.handler(tool("Edit", path));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("resolves tilde paths", () => {
    it("allows ~/project/file.ts when projectRoot matches", async () => {
      const result = await allowEditInProject.handler(tool("Edit", "~/myproject/src/index.ts", HOME_PROJECT));
      expect(result.verdict).toBe(ALLOW);
    });

    it("next for ~/project/file.ts when projectRoot differs", async () => {
      const result = await allowEditInProject.handler(tool("Edit", "~/other/file.ts", HOME_PROJECT));
      expect(result.verdict).toBe(NEXT);
    });

    it("next for tilde path to sensitive file", async () => {
      const result = await allowEditInProject.handler(tool("Edit", "~/myproject/.env", HOME_PROJECT));
      expect(result.verdict).toBe(NEXT);
    });
  });

  it("passes through non-Edit/Write tools", async () => {
    const result = await allowEditInProject.handler(tool("Bash", `${PROJECT}/file.ts`));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through when no project root", async () => {
    const result = await allowEditInProject.handler(tool("Edit", `${PROJECT}/file.ts`, null));
    expect(result.verdict).toBe(NEXT);
  });
});
