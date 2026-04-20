import { describe, expect, it } from "bun:test";
import { DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import redirectPythonJsonToFx from "../redirect-python-json-to-fx";

const PROJECT = "/home/user/project";

function bash(command: string, description?: string): ToolCall {
  return {
    tool: "Bash",
    args: { command, ...(description !== undefined ? { description } : {}) },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("redirect-python-json-to-fx", () => {
  describe("hard block: python3 -m json.tool", () => {
    const denied = [
      "python3 -m json.tool",
      "python3 -m json.tool < file.json",
      "cat data.json | python3 -m json.tool",
      "xh GET http://localhost/api | python3 -m json.tool",
      "xh GET http://localhost/api | python3 -m json.tool | head -40",
      "python -m json.tool",
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd}`, async () => {
        const result = await redirectPythonJsonToFx.handler(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("intent-based block: python3 + JSON description", () => {
    const cases = [
      {
        cmd: 'python3 -c "import sys,json; d=json.load(sys.stdin); print(d[\'key\'])"',
        desc: "Parse JSON response from API",
      },
      {
        cmd: 'xh GET http://localhost/api | python3 -c "import sys,json; print(json.load(sys.stdin)[\'name\'])"',
        desc: "Extract field from JSON response",
      },
      {
        cmd: 'python3 -c "import json; print(json.dumps(json.load(open(\'config.json\')), indent=2))"',
        desc: "Pretty-print JSON config",
      },
      {
        cmd: 'curl -s http://localhost/api | python3 -c "import json,sys; d=json.load(sys.stdin); print(d)"',
        desc: "Check API response",
      },
      {
        cmd: 'python3 -c "import json; d=json.load(open(\'data.json\')); print(d[\'users\'][0])"',
        desc: "Inspect JSON data structure",
      },
      {
        cmd: 'xh GET http://example.com/api | python3 -c "import json,sys; print(json.load(sys.stdin))"',
        desc: "Check endpoint response",
      },
      {
        cmd: 'python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get(\'content\',{}).get(\'footer\',{}))"',
        desc: "Extract value from JSON output",
      },
      {
        cmd: 'python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))"',
        desc: "Format API response output",
      },
    ];

    for (const { cmd, desc } of cases) {
      it(`denies: "${desc}"`, async () => {
        const result = await redirectPythonJsonToFx.handler(bash(cmd, desc));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("passes through legitimate python usage", () => {
    const allowed = [
      {
        cmd: 'python3 -c "import json, os\nfor d in os.listdir(base):\n    cfg = os.path.join(base, d)\n    print(d)"',
        desc: "Scan tenant configs for layout types",
      },
      {
        cmd: 'python3 -c "print(\'hello world\')"',
        desc: "Test python works",
      },
      {
        cmd: "python3 script.py",
        desc: "Run migration script",
      },
      {
        cmd: 'python3 -c "import socket; print(socket.getaddrinfo(\'localhost\', 443))"',
        desc: "Check DNS resolution",
      },
      {
        cmd: 'python3 -c "import json, shutil\n# complex atomic write logic"',
        desc: "Migrate config files atomically",
      },
    ];

    for (const { cmd, desc } of allowed) {
      it(`passes through: "${desc}"`, async () => {
        const result = await redirectPythonJsonToFx.handler(bash(cmd, desc));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("passes through when no description", () => {
    it("python3 -c with json but no description", async () => {
      const result = await redirectPythonJsonToFx.handler(
        bash('python3 -c "import json; print(json.load(open(\'x.json\')))"'),
      );
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("passes through non-python commands", () => {
    const ignored = [
      { cmd: "ls -la", desc: "List files" },
      { cmd: "git status", desc: "Check git status" },
      { cmd: "fx '.name'", desc: "Extract JSON field" },
      { cmd: "cat data.json | gron | grep email", desc: "Find email in JSON" },
    ];

    for (const { cmd, desc } of ignored) {
      it(`passes through: ${cmd}`, async () => {
        const result = await redirectPythonJsonToFx.handler(bash(cmd, desc));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("ignores non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/some/file.json" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await redirectPythonJsonToFx.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
