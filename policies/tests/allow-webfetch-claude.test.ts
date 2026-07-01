import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowWebFetchClaude from "../allow-webfetch-claude";

const run = adaptHandler(allowWebFetchClaude.action!, allowWebFetchClaude.handler as any);

const PROJECT = "/home/user/project";

function webfetch(url: string): ToolCall {
  return {
    tool: "WebFetch",
    args: { url, prompt: "test" },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-webfetch-claude", () => {
  describe("allows claude.com URLs", () => {
    it("allows docs.claude.com", async () => {
      const result = await run(webfetch("https://docs.claude.com/page"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows claude.com root", async () => {
      const result = await run(webfetch("https://claude.com/"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows subdomain.claude.com", async () => {
      const result = await run(webfetch("https://api.claude.com/v1/messages"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows deep subdomain", async () => {
      const result = await run(webfetch("https://a.b.claude.com/path"));
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("rejects non-claude URLs", () => {
    it("rejects other domains", async () => {
      const result = await run(webfetch("https://example.com"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects similar-looking domains", async () => {
      const result = await run(webfetch("https://notclaude.com/page"));
      expect(result.verdict).toBe(NEXT);
    });

    it("rejects claude.com as subdomain of another domain", async () => {
      const result = await run(webfetch("https://evil-claude.com/page"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  it("passes through non-WebFetch tools", async () => {
    const call: ToolCall = {
      tool: "Bash",
      args: { command: "curl https://claude.com" },
      context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
    };
    const result = await run(call);
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through invalid URLs", async () => {
    const result = await run(webfetch("not-a-url"));
    expect(result.verdict).toBe(NEXT);
  });
});
