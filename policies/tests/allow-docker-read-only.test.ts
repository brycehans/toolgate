import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowDockerReadOnly from "../allow-docker-read-only";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project" },
  };
}

describe("allow-docker-read-only", () => {
  describe("allows read-only docker subcommands", () => {
    const allowed = [
      "docker ps",
      "docker ps -a",
      "docker images",
      "docker logs my-container",
      "docker logs -f my-container",
      "docker inspect my-container",
      "docker version",
      "docker info",
      "docker stats --no-stream",
      "docker top my-container",
      "docker port my-container",
      "docker history my-image",
      "docker diff my-container",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowDockerReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("allows namespaced read-only docker commands", () => {
    const allowed = [
      "docker image ls",
      "docker image inspect alpine",
      "docker container ls -a",
      "docker container logs app",
      "docker network ls",
      "docker network inspect bridge",
      "docker volume ls",
      "docker volume inspect data",
      "docker system info",
      "docker system df",
      "docker service ls",
      "docker stack ps mystack",
      "docker context ls",
      "docker plugin ls",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowDockerReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("allows read-only docker compose subcommands", () => {
    const allowed = [
      "docker compose ps",
      "docker compose ps -a",
      "docker compose logs",
      "docker compose logs -f app",
      "docker compose top",
      "docker compose images",
      "docker compose config",
      "docker compose ls",
      "docker compose version",
      // The reported failing case:
      "docker compose --env-file .worktree-env -f docker-compose.worktree.yml ps",
      "docker compose -f docker-compose.yml -p myproj logs app",
      "docker compose --project-name foo ps",
      "docker compose --env-file=.env ps",
      // Piped to a safe filter.
      "docker compose --env-file .worktree-env -f docker-compose.worktree.yml ps 2>&1 | head -10",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowDockerReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects writing/mutating docker subcommands", () => {
    const rejected = [
      "docker run alpine",
      "docker rm my-container",
      "docker rmi my-image",
      "docker stop my-container",
      "docker start my-container",
      "docker restart my-container",
      "docker kill my-container",
      "docker exec my-container ls",
      "docker pull alpine",
      "docker push myreg/img",
      "docker build .",
      "docker tag old new",
      "docker network create foo",
      "docker volume rm data",
      "docker compose up",
      "docker compose down",
      "docker compose restart app",
      "docker compose exec app sh",
      "docker compose run --rm app sh",
      "docker compose -f docker-compose.yml up -d",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowDockerReadOnly.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("ignores non-docker commands", async () => {
    const result = await allowDockerReadOnly.handler(bash("kubectl get pods"));
    expect(result.verdict).toBe(NEXT);
  });

  it("ignores non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/etc/hosts" },
      context: { cwd: "/x", env: {}, projectRoot: "/x" },
    };
    const result = await allowDockerReadOnly.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
