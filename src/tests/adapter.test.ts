import { describe, expect, it } from "bun:test";
import { adaptHandler } from "../adapter";
import { ALLOW, DENY, NEXT } from "../verdicts";

describe("adaptHandler", () => {
  describe("allow action", () => {
    it("converts true to ALLOW", async () => {
      const handler = adaptHandler("allow", async () => true);
      const result = await handler({} as any);
      expect(result.verdict).toBe(ALLOW);
    });

    it("converts void/undefined to NEXT", async () => {
      const handler = adaptHandler("allow", async () => {});
      const result = await handler({} as any);
      expect(result.verdict).toBe(NEXT);
    });

    it("converts false to NEXT", async () => {
      const handler = adaptHandler("allow", async () => false);
      const result = await handler({} as any);
      expect(result.verdict).toBe(NEXT);
    });

    it("converts string to ALLOW (truthy value)", async () => {
      const handler = adaptHandler("allow", async () => "some reason");
      const result = await handler({} as any);
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("deny action", () => {
    it("converts true to DENY without reason", async () => {
      const handler = adaptHandler("deny", async () => true);
      const result = await handler({} as any);
      expect(result.verdict).toBe(DENY);
      expect("reason" in result).toBe(false);
    });

    it("converts string to DENY with reason", async () => {
      const handler = adaptHandler("deny", async () => "not allowed here");
      const result = await handler({} as any);
      expect(result.verdict).toBe(DENY);
      expect((result as any).reason).toBe("not allowed here");
    });

    it("converts void/undefined to NEXT", async () => {
      const handler = adaptHandler("deny", async () => {});
      const result = await handler({} as any);
      expect(result.verdict).toBe(NEXT);
    });

    it("converts false to NEXT", async () => {
      const handler = adaptHandler("deny", async () => false);
      const result = await handler({} as any);
      expect(result.verdict).toBe(NEXT);
    });
  });
});
