import type { ToolCall } from "../src";
import { allow, next, type Policy } from "../src";
import {
  Op,
  type BinaryCmd,
  type DblQuoted,
  type Lit,
  type SglQuoted,
  type Stmt,
  type Word,
  getArgs,
  hasUnsafeNodes,
  isSafeFilter,
  parseShell,
  wordToString,
} from "./parse-bash-ast";

/**
 * Permit read-only mysql queries through `docker compose exec`. Supports two
 * forms:
 *
 *   docker compose [flags] exec [flags] <svc> mysql [flags...] -e '<SQL>'
 *   docker compose [flags] exec [flags] <svc> sh -c "mysql [flags...] -e '<SQL>'"
 *
 * The whole thing may optionally be piped to safe filters (head/tail/grep/etc).
 * `<SQL>` must be one or more read-only statements (SELECT/SHOW/DESC/EXPLAIN/...).
 */

const COMPOSE_FLAGS_WITH_VALUE = new Set([
  "-f", "--file",
  "--env-file",
  "-p", "--project-name",
  "--project-directory",
  "--profile",
  "--ansi",
  "--progress",
  "--parallel",
]);

const EXEC_FLAGS_WITH_VALUE = new Set([
  "-u", "--user",
  "-w", "--workdir",
  "-e", "--env",
  "--index",
]);

const EXEC_BOOLEAN_FLAGS = new Set([
  "-T",
  "--no-TTY",
  "-i", "--interactive",
  "-t", "--tty",
]);

const EXEC_FORBIDDEN_FLAGS = new Set([
  "-d", "--detach",
  "--privileged",
]);

const MYSQL_FLAGS_WITH_VALUE = new Set([
  "-h", "--host",
  "-u", "--user",
  "-P", "--port",
  "-S", "--socket",
  "-D", "--database",
  "--default-character-set",
  "--protocol",
  "--connect-timeout",
]);

// Flags like `-p` and `-pPASSWORD` (mysql lets you concat the password) — the
// value form `-p` followed by separate token *prompts* interactively, which
// blocks. The concatenated form `-pPASSWORD` is a single token. We treat any
// lone `-p` as boolean (no value consumed) since requiring a value tends to
// hang anyway.
const MYSQL_BOOLEAN_OR_CONCAT_FLAGS = new Set([
  "-p",
  "--password",
  "-N", "--skip-column-names",
  "-s", "--silent",
  "-v", "--verbose",
  "-t", "--table",
  "-B", "--batch",
  "-X", "--xml",
  "--html",
  "-r", "--raw",
  "--vertical",
  "-E",
  "--show-warnings",
  "--ssl",
  "--ssl-mode=DISABLED",
]);

const READ_ONLY_SQL_VERBS = new Set([
  "SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "USE", "HELP", "WITH", "VALUES",
]);

function isReadOnlySql(sql: string): boolean {
  // Reject SQL comments — they can hide payload.
  if (sql.includes("--") || sql.includes("/*") || sql.includes("#")) return false;
  const stmts = sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  if (stmts.length === 0) return false;
  for (const stmt of stmts) {
    const firstWord = stmt.split(/\s+/)[0]?.toUpperCase();
    if (!firstWord || !READ_ONLY_SQL_VERBS.has(firstWord)) return false;
  }
  return true;
}

/**
 * Resolve a Word to a static string, allowing mixed Lit + single/double-quoted
 * parts (including DblQuoted that wraps further Lit/SglQuoted). Returns null
 * if any part involves expansion (ParamExp, CmdSubst, ArithmExp, ProcSubst).
 */
function staticString(word: Word): string | null {
  const out: string[] = [];
  for (const part of word.Parts) {
    if (part.Type === "Lit") {
      out.push((part as Lit).Value);
    } else if (part.Type === "SglQuoted") {
      out.push((part as SglQuoted).Value);
    } else if (part.Type === "DblQuoted") {
      const dbl = part as DblQuoted;
      for (const inner of dbl.Parts ?? []) {
        if (inner.Type === "Lit") {
          out.push((inner as Lit).Value);
        } else if (inner.Type === "SglQuoted") {
          out.push((inner as SglQuoted).Value);
        } else {
          return null;
        }
      }
    } else {
      return null;
    }
  }
  return out.join("");
}

/** Re-parse a string and return its single CallExpr's args, or null. */
async function reparseToCallExpr(s: string): Promise<string[] | null> {
  const file = await parseShell(s);
  if (!file) return null;
  if (file.Stmts.length !== 1) return null;
  if (hasUnsafeNodes(file)) return null;
  const stmt = file.Stmts[0];
  if (stmt.Background || stmt.Negated) return null;
  if ((stmt as any).Comments?.length > 0) return null;
  if (stmt.Redirs && stmt.Redirs.length > 0) return null;
  if (stmt.Cmd?.Type !== "CallExpr") return null;
  return getArgs(stmt);
}

/** Walk past flags, returning index of the next positional arg or null. */
function skipFlags(
  tokens: string[],
  start: number,
  flagsWithValue: Set<string>,
  booleanFlags: Set<string> | null,
  forbiddenFlags: Set<string> | null,
): number | null {
  let i = start;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.startsWith("-")) return i;
    if (forbiddenFlags && forbiddenFlags.has(t)) return null;
    if (t.includes("=")) {
      const flagName = t.slice(0, t.indexOf("="));
      if (forbiddenFlags && forbiddenFlags.has(flagName)) return null;
      i += 1;
      continue;
    }
    if (flagsWithValue.has(t)) {
      i += 2;
      continue;
    }
    if (!booleanFlags || booleanFlags.has(t)) {
      i += 1;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Validate that `mysql [flags...] -e <SQL> [...]` is read-only. Every -e
 * value must be read-only SQL. Returns true if the command is a safe mysql
 * invocation.
 */
function isReadOnlyMysqlCall(tokens: string[]): boolean {
  if (tokens[0] !== "mysql") return false;
  let sawDashE = false;
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "-e" || t === "--execute") {
      if (i + 1 >= tokens.length) return false;
      const sql = tokens[i + 1];
      if (!isReadOnlySql(sql)) return false;
      sawDashE = true;
      i += 2;
      continue;
    }
    // --execute=SQL or --execute='SQL'
    if (t.startsWith("--execute=")) {
      const sql = t.slice("--execute=".length);
      if (!isReadOnlySql(sql)) return false;
      sawDashE = true;
      i += 1;
      continue;
    }
    if (MYSQL_FLAGS_WITH_VALUE.has(t)) {
      i += 2;
      continue;
    }
    if (t.includes("=") && t.startsWith("--")) {
      i += 1;
      continue;
    }
    if (MYSQL_BOOLEAN_OR_CONCAT_FLAGS.has(t)) {
      i += 1;
      continue;
    }
    // Concatenated flag forms (-pPASS, -hHOST, -uUSER, etc.) — single token.
    if (t.startsWith("-") && t.length > 2 && !t.startsWith("--")) {
      i += 1;
      continue;
    }
    // --long=value already handled above; any other --long flag we don't
    // recognise → bail (could change behavior unexpectedly).
    if (t.startsWith("--")) {
      i += 1;
      continue;
    }
    // Positional arg (e.g. database name without -D) — accept.
    i += 1;
  }
  return sawDashE;
}

/**
 * Walk the outermost stmt as: 0+ pipes to safe filters, with our target
 * docker-compose call at the leftmost leaf.
 */
function unwrapTopLevelPipes(stmt: Stmt): { leaf: Stmt } | null {
  let cur: Stmt = stmt;
  if (cur.Background || cur.Negated) return null;
  if ((cur as any).Comments?.length > 0) return null;
  while (cur.Cmd?.Type === "BinaryCmd") {
    const bin = cur.Cmd as BinaryCmd;
    if (bin.Op !== Op.Pipe) return null;
    if (bin.Y.Background || bin.Y.Negated) return null;
    const rightArgs = getArgs(bin.Y);
    if (!rightArgs || !isSafeFilter(rightArgs)) return null;
    cur = bin.X;
  }
  return { leaf: cur };
}

async function check(call: ToolCall): Promise<boolean> {
  if (call.tool !== "Bash") return false;
  const command = call.args?.command;
  if (typeof command !== "string") return false;

  const file = await parseShell(command);
  if (!file) return false;
  if (file.Stmts.length !== 1) return false;
  if (hasUnsafeNodes(file)) return false;

  const unwrapped = unwrapTopLevelPipes(file.Stmts[0]);
  if (!unwrapped) return false;
  const leaf = unwrapped.leaf;
  if (leaf.Cmd?.Type !== "CallExpr") return false;
  if (leaf.Background || leaf.Negated) return false;

  // Extract docker compose [flags] exec [flags] <svc> <rest...>
  // We need the raw Word array because the inner sh -c arg may be a multi-part
  // quoted string that wordToString rejects. Walk args manually.
  const argWords = (leaf.Cmd as any).Args as Word[];
  if (!argWords || argWords.length < 4) return false;

  // Resolve each Word to a string using staticString (allows multi-part static).
  const tokens: string[] = [];
  for (const w of argWords) {
    // Prefer wordToString for the common case; fall back to staticString.
    const simple = wordToString(w);
    if (simple !== null) {
      tokens.push(simple);
    } else {
      const sx = staticString(w);
      if (sx === null) return false;
      tokens.push(sx);
    }
  }

  if (tokens[0] !== "docker" || tokens[1] !== "compose") return false;

  const execIdx = skipFlags(tokens, 2, COMPOSE_FLAGS_WITH_VALUE, null, null);
  if (execIdx === null || tokens[execIdx] !== "exec") return false;

  const serviceIdx = skipFlags(
    tokens,
    execIdx + 1,
    EXEC_FLAGS_WITH_VALUE,
    EXEC_BOOLEAN_FLAGS,
    EXEC_FORBIDDEN_FLAGS,
  );
  if (serviceIdx === null) return false;

  const innerStart = serviceIdx + 1;
  if (innerStart >= tokens.length) return false;

  // Direct form: docker compose exec <svc> mysql ...
  if (tokens[innerStart] === "mysql") {
    return isReadOnlyMysqlCall(tokens.slice(innerStart));
  }

  // sh -c form: docker compose exec <svc> sh -c "<inner>"
  if (tokens[innerStart] === "sh" && tokens[innerStart + 1] === "-c") {
    const inner = tokens[innerStart + 2];
    if (inner === undefined) return false;
    // Reject if there are extra tokens after the sh -c arg (positional $0 etc.)
    if (innerStart + 3 !== tokens.length) return false;
    const innerArgs = await reparseToCallExpr(inner);
    if (!innerArgs) return false;
    return isReadOnlyMysqlCall(innerArgs);
  }

  return false;
}

const allowDockerComposeExecMysqlReadOnly: Policy = {
  name: "Allow docker compose exec mysql (read-only)",
  description:
    "Permits `docker compose exec <svc> mysql -e '<SQL>'` (and `sh -c \"mysql -e '<SQL>'\"`) when every SQL statement is read-only (SELECT/SHOW/DESC/EXPLAIN/USE/HELP/WITH/VALUES)",
  handler: async (call) => {
    return (await check(call)) ? allow() : next();
  },
};

export default allowDockerComposeExecMysqlReadOnly;
