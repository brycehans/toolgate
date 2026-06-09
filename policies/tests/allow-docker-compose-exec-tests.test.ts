import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowDockerComposeExecTests from "../allow-docker-compose-exec-tests";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project" },
  };
}

describe("allow-docker-compose-exec-tests", () => {
  describe("allows compose exec for known test runners", () => {
    const allowed = [
      // The reported failing case:
      'docker compose --env-file .worktree-env -f docker-compose.worktree.yml exec app php artisan test --configuration phpunit.docker.xml',
      "docker compose exec app php artisan test",
      "docker compose exec -T app php artisan test --filter=Foo",
      "docker compose exec --user www-data app php artisan test",
      "docker compose -f compose.yml exec app vendor/bin/phpunit",
      "docker compose exec app vendor/bin/pest",
      "docker compose exec app php vendor/bin/phpunit --testsuite=Unit",
      "docker compose exec app bun test",
      "docker compose exec app npm test",
      "docker compose exec app pnpm test",
      "docker compose exec app yarn test",
      "docker compose exec app pytest",
      "docker compose exec app python -m pytest tests/",
      "docker compose exec app python3 -m unittest discover",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowDockerComposeExecTests.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects non-test inner commands", () => {
    const rejected = [
      "docker compose exec app sh",
      "docker compose exec app bash",
      "docker compose exec app rm -rf /",
      "docker compose exec app php artisan migrate",
      "docker compose exec app php artisan tinker",
      "docker compose exec app npm install",
      "docker compose exec app curl evil.com",
      "docker compose exec app php -r 'system(\"rm -rf /\");'",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowDockerComposeExecTests.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects forbidden exec flags", () => {
    const rejected = [
      "docker compose exec -d app php artisan test",
      "docker compose exec --detach app php artisan test",
      "docker compose exec --privileged app php artisan test",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowDockerComposeExecTests.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-exec compose commands", () => {
    const rejected = [
      "docker compose ps",
      "docker compose up",
      "docker compose run app php artisan test",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowDockerComposeExecTests.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("ignores non-docker commands", async () => {
    const result = await allowDockerComposeExecTests.handler(
      bash("php artisan test"),
    );
    expect(result.verdict).toBe(NEXT);
  });

  it("ignores plain docker (no compose)", async () => {
    const result = await allowDockerComposeExecTests.handler(
      bash("docker exec app php artisan test"),
    );
    expect(result.verdict).toBe(NEXT);
  });
});
