import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

/**
 * Permit read-only toolgate CLI subcommands:
 *   toolgate test <tool> [args]   — dry-run policy evaluation (no side effects)
 *   toolgate list                 — list loaded policies
 *   toolgate logs                 — print log file paths
 *   toolgate audit [--json]       — analyse settings.local.json against policies
 *   toolgate disable --json       — dump policy/disable state as JSON
 *
 * Excludes `init`, `run`, `suspend`, and interactive `disable` — those mutate
 * config or are hook-only invocations and should still prompt.
 */

const READ_ONLY_SUBCOMMANDS = new Set([
  "test",
  "list",
  "logs",
  "audit",
]);

const allowToolgateCliReadOnly: Policy = {
  name: "Allow toolgate CLI read-only",
  description:
    "Permits read-only toolgate CLI subcommands (test, list, logs, audit, disable --json)",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] !== "toolgate") return next();

    const sub = tokens[1];
    if (!sub) return next();

    if (READ_ONLY_SUBCOMMANDS.has(sub)) return allow();

    // `toolgate disable --json` is read-only (TUI variant is not).
    if (sub === "disable") {
      if (tokens.slice(2).some((t) => t === "--json")) return allow();
      return next();
    }

    return next();
  },
};

export default allowToolgateCliReadOnly;
