/**
 * Codemod: migrate legacy Middleware-style toolgate policies to the 2.x
 * action-based API.
 *
 * Legacy policies (pre-1.0) have no `action` field and return `allow()` /
 * `deny()` / `next()` helper calls. 2.x requires an `action` and returns plain
 * `string | boolean | void`. This transform:
 *
 *   - anchors on the module `definePolicy` is imported from, and treats the
 *     `allow` / `deny` / `next` bindings from that same module as legacy helpers
 *     (respecting aliases);
 *   - infers each policy's `action` from which helpers its handler calls;
 *   - rewrites `allow()`→`true`, `deny(x)`→`x`, `deny()`→`true`, `next()`→`undefined`;
 *   - inserts the `action` property;
 *   - strips the now-dead helper imports.
 *
 * Changes are applied as position-based text splices so existing formatting is
 * preserved (the file is parsed, never reprinted).
 *
 * A policy whose handler calls BOTH allow() and deny() can't map to one
 * action — it must be split into two policies with distinct names, which needs
 * a human. Such a file is reported and left untouched (nothing is written).
 */
import ts from "typescript";

export type MigrateStatus = "migrated" | "unchanged" | "skipped";

export interface PolicyChange {
  /** The policy's `name` value, if a string literal; else a positional label. */
  name: string;
  /** Inferred action, or null when the policy was skipped. */
  action: "allow" | "deny" | null;
  /** Human-readable summary of the rewrites applied to this policy. */
  detail: string;
}

export interface MigrateResult {
  status: MigrateStatus;
  /** The transformed source (equals input when status !== "migrated"). */
  code: string;
  /** Per-policy report. */
  policies: PolicyChange[];
  /** Import specifiers removed (e.g. ["allow", "next"]). */
  removedImports: string[];
  /** Non-fatal notes and the reasons a file was skipped. */
  warnings: string[];
}

type HelperKind = "allow" | "deny" | "next";

interface Splice {
  start: number;
  end: number;
  text: string;
}

const LEGACY_NAMES: HelperKind[] = ["allow", "deny", "next"];

/**
 * Transform a single config file's source. Pure — no filesystem access.
 */
export function migrateSource(code: string): MigrateResult {
  const sf = ts.createSourceFile(
    "config.ts",
    code,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const result: MigrateResult = {
    status: "unchanged",
    code,
    policies: [],
    removedImports: [],
    warnings: [],
  };

  // --- 1. Find where `definePolicy` is imported from, and map legacy helper
  //        local names → kind, restricted to those same module specifiers. ---
  const definePolicyModules = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const named = stmt.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
    for (const el of named.elements) {
      if ((el.propertyName ?? el.name).text === "definePolicy") {
        definePolicyModules.add(spec);
      }
    }
  }

  // local name → helper kind
  const helperLocals = new Map<string, HelperKind>();
  // import declarations that need specifier surgery
  const importEdits: Splice[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const clause = stmt.importClause;
    const named = clause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
    if (!definePolicyModules.has(spec)) continue;

    const kept: string[] = [];
    const removed: string[] = [];
    for (const el of named.elements) {
      const imported = (el.propertyName ?? el.name).text as HelperKind;
      if (LEGACY_NAMES.includes(imported)) {
        helperLocals.set(el.name.text, imported);
        removed.push(el.getText(sf));
      } else {
        kept.push(el.getText(sf));
      }
    }
    if (removed.length === 0) continue;
    result.removedImports.push(...removed);

    if (kept.length === 0 && !clause.name) {
      // Whole import becomes dead — remove the statement and its line break.
      let end = stmt.end;
      while (end < code.length && code[end] !== "\n") end++;
      if (code[end] === "\n") end++;
      importEdits.push({ start: stmt.getStart(sf), end, text: "" });
    } else {
      // Rewrite just the `{ ... }` named-imports list.
      importEdits.push({
        start: named.getStart(sf),
        end: named.end,
        text: `{ ${kept.join(", ")} }`,
      });
    }
  }

  if (helperLocals.size === 0) {
    // No legacy helpers in play. Either already migrated or not a policy file.
    return result;
  }

  // --- 2. Guard: every reference to a legacy local name must be the callee of
  //        a call expression we can rewrite. A bare reference (passed as a
  //        value, aliased at runtime, etc.) means we can't safely transform. ---
  const badRefs: string[] = [];
  const collectBadRefs = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      helperLocals.has(node.text) &&
      !isImportSpecifierName(node)
    ) {
      const parent = node.parent;
      const isCallee =
        parent && ts.isCallExpression(parent) && parent.expression === node;
      if (!isCallee) badRefs.push(node.text);
    }
    ts.forEachChild(node, collectBadRefs);
  };
  collectBadRefs(sf);
  if (badRefs.length > 0) {
    result.status = "skipped";
    result.warnings.push(
      `Legacy helper(s) ${uniq(badRefs).join(", ")} are used outside a direct call ` +
        `(e.g. passed as a value). Migrate this file by hand.`,
    );
    return result;
  }

  // --- 3. Locate the definePolicy([...]) array and iterate policy objects. ---
  const policyObjects: ts.ObjectLiteralExpression[] = [];
  const findPolicies = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "definePolicy" &&
      node.arguments.length > 0 &&
      ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      for (const el of node.arguments[0].elements) {
        if (ts.isObjectLiteralExpression(el)) policyObjects.push(el);
      }
    }
    ts.forEachChild(node, findPolicies);
  };
  findPolicies(sf);

  const bodyEdits: Splice[] = [];
  let mixedFound = false;

  for (const obj of policyObjects) {
    const nameProp = getProp(obj, "name");
    const label =
      nameProp && ts.isStringLiteralLike(nameProp.initializer)
        ? nameProp.initializer.text
        : `(policy at ${lineOf(sf, obj)})`;

    // Already action-based? Leave it alone.
    if (getProp(obj, "action")) {
      continue;
    }

    const handler = getProp(obj, "handler");
    if (!handler) continue;

    // Gather helper calls inside the handler.
    const calls: { node: ts.CallExpression; kind: HelperKind }[] = [];
    const scan = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const kind = helperLocals.get(node.expression.text);
        if (kind) calls.push({ node, kind });
      }
      ts.forEachChild(node, scan);
    };
    scan(handler.initializer);

    const hasAllow = calls.some((c) => c.kind === "allow");
    const hasDeny = calls.some((c) => c.kind === "deny");

    if (hasAllow && hasDeny) {
      mixedFound = true;
      result.policies.push({
        name: label,
        action: null,
        detail:
          "MIXED allow() + deny() — split into a deny policy and an allow " +
          "policy (deny runs first, so the split is behaviour-preserving). Manual.",
      });
      continue;
    }

    const action: "allow" | "deny" = hasDeny ? "deny" : "allow";
    if (!hasAllow && !hasDeny) {
      result.warnings.push(
        `Policy "${label}" never returns allow()/deny() — defaulting to ` +
          `action: "allow" (it never activates either way).`,
      );
    }

    // Rewrite each helper call.
    let rewrites = 0;
    for (const { node, kind } of calls) {
      bodyEdits.push({
        start: node.getStart(sf),
        end: node.end,
        text: replacementFor(kind, node, sf),
      });
      rewrites++;
    }

    // Insert the action property after `description` (else `name`, else first).
    const anchor =
      getProp(obj, "description") ??
      nameProp ??
      (obj.properties.length > 0 ? obj.properties[0] : undefined);
    if (anchor) {
      const indent = indentOf(code, anchor.getStart(sf));
      bodyEdits.push({
        start: anchor.end,
        end: anchor.end,
        text: `,\n${indent}action: "${action}"`,
      });
    }

    result.policies.push({
      name: label,
      action,
      detail: `action: "${action}"; ${rewrites} return${rewrites === 1 ? "" : "s"} rewritten`,
    });
  }

  if (mixedFound) {
    result.status = "skipped";
    result.warnings.push(
      "File contains policies that mix allow() and deny(); nothing was written. " +
        "Split those policies by hand, then re-run.",
    );
    return result;
  }

  const edits = [...importEdits, ...bodyEdits];
  if (edits.length === 0) {
    return result;
  }

  result.code = applySplices(code, edits);
  result.status = "migrated";
  return result;
}

// --- helpers ---------------------------------------------------------------

function replacementFor(
  kind: HelperKind,
  node: ts.CallExpression,
  sf: ts.SourceFile,
): string {
  if (kind === "allow") return "true";
  if (kind === "next") return "undefined";
  // deny
  if (node.arguments.length === 0) return "true";
  return node.arguments[0].getText(sf);
}

function getProp(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const p of obj.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) &&
      p.name.text === name
    ) {
      return p;
    }
  }
  return undefined;
}

function isImportSpecifierName(node: ts.Identifier): boolean {
  const p = node.parent;
  return !!p && ts.isImportSpecifier(p);
}

/** Leading whitespace of the line containing `pos`. */
function indentOf(code: string, pos: number): string {
  let start = pos;
  while (start > 0 && code[start - 1] !== "\n") start--;
  let i = start;
  while (i < code.length && (code[i] === " " || code[i] === "\t")) i++;
  return code.slice(start, i);
}

function lineOf(sf: ts.SourceFile, node: ts.Node): string {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `line ${line + 1}`;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

/** Apply non-overlapping splices, right-to-left so offsets stay valid. */
function applySplices(code: string, edits: Splice[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}
