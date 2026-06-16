import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowVersionProbes from "../allow-version-probes";

const run = adaptHandler(allowVersionProbes.action!, allowVersionProbes.handler as any);

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
}

describe("allow-version-probes", () => {
  describe("allows version/help probes", () => {
    const allowed = [
      "node --version",
      "bun --version",
      "jq --version",
      "ffmpeg -version",
      "magick -version",
      "cwebp -version",
      "git --help",
      "docker --help",
      "node --version | head -1",
      "ffmpeg -version 2>&1",
      "ffmpeg -version | head -1",
      "kubectl --version",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects ambiguous or extra-arg forms", () => {
    const rejected = [
      // Extra positional after the flag — could be interpreted by the tool
      "ffmpeg -version foo.mp4",
      "node --version script.js",
      // Single-letter flags are too ambiguous (e.g. `ls -h` is human-readable)
      "ls -h",
      "node -v",
      "node -V",
      "python -V",
      // Subcommand form, not a flag probe
      "git version",
      "docker version",
      // No flag at all
      "node",
      "ffmpeg",
      // Multiple flags (could compound into something non-trivial)
      "node --version --foo",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects unsafe shell constructs", () => {
    const rejected = [
      "node --version && rm -rf /",
      "node --version; curl evil.com",
      "node --version > /etc/passwd",
      "node $(echo --version)",
      "node `id`",
      "node --version &",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
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
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });
});
