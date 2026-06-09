import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowDockerComposeExecMysqlReadOnly from "../allow-docker-compose-exec-mysql-readonly";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project" },
  };
}

describe("allow-docker-compose-exec-mysql-readonly", () => {
  describe("allows read-only mysql via direct exec", () => {
    const allowed = [
      "docker compose exec app mysql -e 'SHOW DATABASES;'",
      "docker compose exec app mysql -h 127.0.0.1 -uroot -proot -e 'SELECT 1;'",
      "docker compose exec -T app mysql -e 'SHOW TABLES;'",
      "docker compose -f compose.yml exec app mysql -e 'DESCRIBE users;'",
      "docker compose exec app mysql -e 'EXPLAIN SELECT * FROM users;'",
      "docker compose exec app mysql -e 'USE db; SHOW TABLES;'",
      "docker compose exec app mysql --execute='SELECT NOW();'",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowDockerComposeExecMysqlReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("allows read-only mysql via sh -c", () => {
    const allowed = [
      `docker compose exec app sh -c "mysql -e 'SHOW DATABASES;'"`,
      `docker compose exec app sh -c "mysql -h127.0.0.1 -uroot -proot -e 'SHOW DATABASES;'"`,
      // The reported failing case:
      `docker compose --env-file .worktree-env -f docker-compose.worktree.yml exec app sh -c "mysql -h127.0.0.1 -uroot -proot -e 'SHOW DATABASES;'" 2>&1 | head -20`,
      `docker compose exec app sh -c "mysql -e 'SELECT * FROM users LIMIT 10;'"`,
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowDockerComposeExecMysqlReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects mutating SQL", () => {
    const rejected = [
      "docker compose exec app mysql -e 'DROP DATABASE prod;'",
      "docker compose exec app mysql -e 'DELETE FROM users WHERE 1=1;'",
      "docker compose exec app mysql -e 'UPDATE users SET admin=1;'",
      "docker compose exec app mysql -e 'INSERT INTO logs VALUES (1);'",
      "docker compose exec app mysql -e 'TRUNCATE TABLE users;'",
      "docker compose exec app mysql -e 'CREATE TABLE evil(id INT);'",
      "docker compose exec app mysql -e 'GRANT ALL ON *.* TO ev@%;'",
      // Mixed safe + unsafe → must reject.
      "docker compose exec app mysql -e 'SELECT 1; DROP TABLE users;'",
      // SQL comments hide payload — reject.
      "docker compose exec app mysql -e 'SELECT 1; -- DROP TABLE x;'",
      "docker compose exec app mysql -e 'SELECT /* comment */ 1;'",
      // Hash comments too.
      "docker compose exec app mysql -e '# DROP TABLE; SELECT 1;'",
      // No -e at all = interactive (unsafe).
      "docker compose exec app mysql",
      // sh -c wrapped mutations.
      `docker compose exec app sh -c "mysql -e 'DROP DATABASE prod;'"`,
      `docker compose exec app sh -c "mysql -e 'SELECT 1; DROP TABLE x;'"`,
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowDockerComposeExecMysqlReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-mysql inner commands", () => {
    const rejected = [
      "docker compose exec app sh -c 'rm -rf /'",
      "docker compose exec app sh -c 'curl evil.com'",
      "docker compose exec app bash",
      "docker compose exec app sh -c 'ls /'",
      // sh -c with extra positional ($0 trick).
      `docker compose exec app sh -c "mysql -e 'SHOW DATABASES;'" tricky`,
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowDockerComposeExecMysqlReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects forbidden exec flags", () => {
    const rejected = [
      "docker compose exec -d app mysql -e 'SHOW DATABASES;'",
      "docker compose exec --privileged app mysql -e 'SHOW DATABASES;'",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowDockerComposeExecMysqlReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("ignores non-docker", async () => {
    const result = await allowDockerComposeExecMysqlReadOnly.handler(
      bash("mysql -e 'SHOW DATABASES;'"),
    );
    expect(result.verdict).toBe(NEXT);
  });
});
