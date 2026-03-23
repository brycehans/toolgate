# toolgate

A policy engine for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) tool permissions. Define middleware policies that automatically allow, deny, or prompt for each tool call.

## Why

Claude Code asks permission before running tools like Bash commands, file writes, etc. Toolgate lets you codify your permission preferences as composable policies — so `git status` is always allowed, destructive commands are always denied, and everything else prompts as normal.

## Install

```bash
bun install -g toolgate
```

## Setup

```bash
# Register the PreToolUse hook globally
toolgate init

# Optionally, create a project-specific config
toolgate init --project
```

This creates a `toolgate.config.ts` and registers a `PreToolUse` hook in `~/.claude/settings.json`.

## Configuration

Policies are defined in `toolgate.config.ts` (project root or `~/.claude/` for global). A config is an array of middleware functions:

```ts
import { definePolicy } from "toolgate";
import allowGitAdd from "./policies/allow-git-add";
import allowBunTest from "./policies/allow-bun-test";

export default definePolicy([
  allowGitAdd,
  allowBunTest,
]);
```

Project policies run first, then global. The first non-`next()` verdict wins.

## Writing Policies

A policy is an async function that inspects a tool call and returns a verdict:

```ts
import { allow, deny, next, type ToolCall } from "toolgate";

export default async function denyRmRf(call: ToolCall) {
  if (call.tool !== "Bash") return next();
  if (call.args.command?.includes("rm -rf")) {
    return deny("Destructive command blocked");
  }
  return next();
}
```

### Verdicts

| Verdict | Effect |
|---------|--------|
| `allow()` | Permit the tool call silently |
| `deny(reason?)` | Block the tool call |
| `next()` | No opinion — pass to next policy (or prompt user if none remain) |

### ToolCall

Each policy receives a `ToolCall` with:

- `tool` — tool name (`"Bash"`, `"Read"`, `"Write"`, `"Edit"`, etc.)
- `args` — tool arguments (e.g. `{ command: "git status" }` for Bash)
- `context.cwd` — working directory
- `context.projectRoot` — git repository root (or `null`)
- `context.env` — environment variables

### Bash Policy Safety

When writing policies for Bash commands, use [`shell-quote`](https://www.npmjs.com/package/shell-quote) to parse commands into tokens rather than matching raw strings with regex. Always reject:

- Command chaining (`&&`, `||`, `;`, `|`, `&`)
- Shell substitution (`$()`, backticks)
- Multiline commands (newlines are command separators)

See [`toolgate/policies/allow-git-add.ts`](toolgate/policies/allow-git-add.ts) for a hardened example.

## Testing

Dry-run a tool call against your policies:

```bash
toolgate test Bash '{"command": "git add ."}'
# → ALLOW

toolgate test Bash '{"command": "git add . && rm -rf /"}'
# → ASK
```

## Example Policies

| Policy | Allows |
|--------|--------|
| `allow-exact-commands` | Exact matches: `git status`, `git diff`, etc. |
| `allow-git-add` | `git add` with safe arguments |
| `allow-bun-test` | `bun test` with safe arguments |
| `allow-read-in-project` | `Read` tool for files within project root |
| `allow-explore-in-project` | `Explore` agent within project root |

## License

MIT
