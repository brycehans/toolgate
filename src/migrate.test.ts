import { describe, expect, it } from "bun:test";
import { migrateSource } from "./migrate";

describe("migrateSource", () => {
  it("migrates an allow-only policy: adds action, rewrites returns, drops imports", () => {
    const src = `import { definePolicy, allow, next } from "toolgate";

export default definePolicy([
  {
    name: "Allow Read",
    description: "Permits Read",
    handler: async (call) => call.tool === "Read" ? allow() : next(),
  },
]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("migrated");
    expect(r.removedImports).toEqual(["allow", "next"]);
    expect(r.code).toContain('import { definePolicy } from "toolgate"');
    expect(r.code).toContain('action: "allow"');
    expect(r.code).toContain("call.tool === \"Read\" ? true : undefined");
    expect(r.code).not.toMatch(/\ballow\(\)/);
    expect(r.code).not.toMatch(/\bnext\(\)/);
    expect(r.policies).toHaveLength(1);
    expect(r.policies[0]).toMatchObject({ name: "Allow Read", action: "allow" });
  });

  it("migrates a deny-only policy: deny(msg) → msg, deny() → true", () => {
    const src = `import { definePolicy, deny, next } from "toolgate";

export default definePolicy([
  {
    name: "Deny rm",
    description: "Blocks rm",
    handler: async (call) => {
      if (call.tool !== "Bash") return next();
      if (call.args.command === "rm -rf /") return deny("nope");
      if (call.args.command.startsWith("rm")) return deny();
      return next();
    },
  },
]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("migrated");
    expect(r.code).toContain('action: "deny"');
    expect(r.code).toContain('return "nope"');
    expect(r.code).toContain("return true"); // deny() → true
    expect(r.code).toContain("return undefined"); // next() → undefined
    expect(r.policies[0].action).toBe("deny");
  });

  it("skips (writes nothing) a policy that mixes allow() and deny()", () => {
    const src = `import { definePolicy, allow, deny, next } from "toolgate";

export default definePolicy([
  {
    name: "Mixed",
    description: "both",
    handler: async (call) => {
      if (bad(call)) return deny("no");
      if (ok(call)) return allow();
      return next();
    },
  },
]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("skipped");
    expect(r.code).toBe(src); // untouched
    expect(r.policies[0].action).toBeNull();
    expect(r.warnings.join(" ")).toContain("mix allow() and deny()");
  });

  it("still migrates other policies' analysis but writes nothing when any is mixed", () => {
    const src = `import { definePolicy, allow, deny, next } from "toolgate";

export default definePolicy([
  { name: "Fine", description: "", handler: async (c) => allow() },
  { name: "Mixed", description: "", handler: async (c) => bad(c) ? deny("x") : allow() },
]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("skipped");
    expect(r.code).toBe(src);
  });

  it("strips dead helper imports from an empty config", () => {
    const src = `import { definePolicy, allow, deny, next } from "toolgate";

export default definePolicy([]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("migrated");
    expect(r.removedImports).toEqual(["allow", "deny", "next"]);
    expect(r.code).toContain('import { definePolicy } from "toolgate"');
    expect(r.policies).toHaveLength(0);
  });

  it("removes the whole import line when only legacy helpers were imported", () => {
    const src = `import { definePolicy } from "toolgate";
import { allow, next } from "toolgate";

export default definePolicy([
  { name: "A", description: "", handler: async (c) => allow() },
]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("migrated");
    expect(r.code).not.toContain('import { allow, next }');
    expect(r.code).toContain('import { definePolicy } from "toolgate"');
  });

  it("is a no-op for already-migrated configs", () => {
    const src = `import { definePolicy } from "toolgate";

export default definePolicy([
  {
    name: "Allow Read",
    description: "",
    action: "allow",
    handler: async (call) => call.tool === "Read" ? true : undefined,
  },
]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("unchanged");
    expect(r.code).toBe(src);
  });

  it("respects import aliases", () => {
    const src = `import { definePolicy, allow as ok, next as skip } from "toolgate";

export default definePolicy([
  { name: "A", description: "", handler: async (c) => c.tool === "Read" ? ok() : skip() },
]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("migrated");
    expect(r.code).toContain('c.tool === "Read" ? true : undefined');
    expect(r.code).toContain('import { definePolicy } from "toolgate"');
  });

  it("skips a file that uses a legacy helper outside a direct call", () => {
    const src = `import { definePolicy, allow, next } from "toolgate";

const fallback = next;
export default definePolicy([
  { name: "A", description: "", handler: async (c) => allow() },
]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("skipped");
    expect(r.code).toBe(src);
    expect(r.warnings.join(" ")).toContain("outside a direct call");
  });

  it("does not touch helpers imported from an unrelated module", () => {
    const src = `import { definePolicy } from "toolgate";
import { allow } from "some-other-lib";

export default definePolicy([
  { name: "A", description: "", action: "allow", handler: async (c) => true },
]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("unchanged");
    expect(r.removedImports).toEqual([]);
    expect(r.code).toBe(src);
  });

  it("defaults a next()-only policy to allow with a warning", () => {
    const src = `import { definePolicy, next } from "toolgate";

export default definePolicy([
  { name: "Inert", description: "", handler: async (c) => next() },
]);
`;
    const r = migrateSource(src);
    expect(r.status).toBe("migrated");
    expect(r.policies[0].action).toBe("allow");
    expect(r.warnings.join(" ")).toContain("never activates");
  });
});
