import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

// Compose CLI flags that consume the next token as a value.
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

// docker <subcommand> — read-only top-level commands.
const DOCKER_READ_ONLY = new Set([
  "ps", "images", "logs", "inspect", "version", "info",
  "stats", "top", "port", "events", "history", "diff",
]);

// docker <resource> <action> — read-only namespaced commands.
const DOCKER_NAMESPACED_READ_ONLY: Record<string, Set<string>> = {
  image: new Set(["ls", "inspect", "history"]),
  container: new Set(["ls", "inspect", "logs", "top", "port", "diff", "stats"]),
  network: new Set(["ls", "inspect"]),
  volume: new Set(["ls", "inspect"]),
  system: new Set(["info", "df", "events"]),
  node: new Set(["ls", "inspect"]),
  service: new Set(["ls", "inspect", "logs", "ps"]),
  stack: new Set(["ls", "ps", "services"]),
  context: new Set(["ls", "inspect", "show"]),
  plugin: new Set(["ls", "inspect"]),
  config: new Set(["ls", "inspect"]),
  secret: new Set(["ls", "inspect"]),
};

// docker compose <subcommand> — read-only.
const COMPOSE_READ_ONLY = new Set([
  "ps", "logs", "top", "images", "config", "port", "ls",
  "version", "events", "convert",
]);

/**
 * Walk past flags (including `--flag value` pairs) and return the index of
 * the first positional argument, or null if none.
 */
function findNextPositional(
  tokens: string[],
  start: number,
  flagsWithValue: Set<string>,
): number | null {
  let i = start;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.startsWith("-")) return i;
    if (t.includes("=")) {
      i += 1;
      continue;
    }
    if (flagsWithValue.has(t)) {
      i += 2;
      continue;
    }
    i += 1;
  }
  return null;
}

const allowDockerReadOnly: Policy = {
  name: "Allow docker read-only",
  description:
    "Permits read-only docker / docker compose subcommands (ps, logs, inspect, config, etc.)",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens || tokens[0] !== "docker") return next();

    // docker compose [compose-flags] <subcommand>
    if (tokens[1] === "compose") {
      const subIdx = findNextPositional(tokens, 2, COMPOSE_FLAGS_WITH_VALUE);
      if (subIdx === null) return next();
      return COMPOSE_READ_ONLY.has(tokens[subIdx]) ? allow() : next();
    }

    const sub = tokens[1];
    if (!sub) return next();

    if (DOCKER_READ_ONLY.has(sub)) return allow();

    const namespaced = DOCKER_NAMESPACED_READ_ONLY[sub];
    if (namespaced && tokens[2] && namespaced.has(tokens[2])) return allow();

    return next();
  },
};

export default allowDockerReadOnly;
