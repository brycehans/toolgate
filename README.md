# toolgate

A policy engine for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) tool permissions. Define policies that automatically allow, deny, or prompt for each tool call.

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

Policies are defined in `toolgate.config.ts` (project root or `~/.claude/` for global). A config is an array of `Policy` objects:

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

A policy is an object with `name`, `description`, and an async `handler` function:

```ts
import { allow, deny, next, type Policy } from "toolgate";

const denyRmRf: Policy = {
  name: "Deny rm -rf",
  description: "Blocks destructive rm -rf commands",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (call.args.command?.includes("rm -rf")) {
      return deny("Destructive command blocked");
    }
    return next();
  },
};
export default denyRmRf;
```

### Verdicts

| Verdict | Effect |
|---------|--------|
| `allow()` | Permit the tool call silently |
| `deny(reason?)` | Block the tool call |
| `next()` | No opinion — pass to next policy (or prompt user if none remain) |

### ToolCall

Each policy handler receives a `ToolCall` with:

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

## CLI

```bash
# Dry-run a tool call against your policies
toolgate test Bash '{"command": "git add ."}'
# → ALLOW

# Show which policy matched and why
toolgate test --why Bash '{"command": "git add ."}'
# → ALLOW
#   why: Allow git add (index 4)
#   description: Permits simple git add commands without chaining or substitution

# List all loaded policies
toolgate list
```

## Example Policies

| Policy | Description |
|--------|-------------|
| `allow-git-add` | Permits `git add` with safe arguments |
| `allow-bun-test` | Permits `bun test` with safe arguments |
| `allow-read-in-project` | Permits `Read` tool for files within project root |
| `allow-explore-in-project` | Permits `Explore` agent within project root |
| `deny-writes-outside-project` | Blocks writes targeting paths outside the project |
| `deny-git-add-and-commit` | Forces `git add` and `git commit` into separate steps |
| `allow-task-create` | Permits `TaskCreate` tool calls for task tracking |

## License

MIT
