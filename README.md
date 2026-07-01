<div align="center">

# toolgate

A policy engine for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) tool permissions. Write composable policies that automatically **allow**, **deny**, or **prompt** for each tool call — so `git status` is always allowed, destructive commands are always denied, and everything else prompts as normal.

</div>

```ts
// toolgate.config.ts — auto-allow curl to localhost
import { definePolicy } from "@brycehanscomb/toolgate";
import { safeBashCommand } from "@brycehanscomb/toolgate/policies/parse-bash-ast";

export default definePolicy([
  {
    name: "Allow curl to localhost",
    description: "Permits curl commands targeting localhost",
    action: "allow",
    handler: async (call) => {
      const args = await safeBashCommand(call);
      if (!args) return; // not a simple command → pass through
      if (args[0] === "curl" && args.some((a) => /^https?:\/\/localhost/.test(a))) {
        return true; // allow
      }
    },
  },
]);
```

Toolgate registers a Claude Code `PreToolUse` hook. Every tool call runs through your policy chain plus **74 built-in policies** before Claude Code decides whether to prompt you.

## Install

### Prerequisites

Toolgate uses [shfmt](https://github.com/mvdan/sh) to parse Bash commands into an AST. Without it, Bash commands fall through and prompt for permission as normal.

```bash
brew install shfmt
# or, with Go (ensure ~/go/bin is on your PATH):
go install mvdan.cc/sh/v3/cmd/shfmt@latest
```

Toolgate runs on [Bun](https://bun.sh) — policies and the CLI are TypeScript executed directly, with no build step.

### Package

Toolgate is not published to npm. Clone the repo and link it (recommended, especially for writing your own policies):

```bash
git clone git@github.com:brycehans/toolgate.git
cd toolgate
bun install
bun link
```

Or install straight from GitHub:

```bash
bun install -g github:brycehans/toolgate
```

Either way, the `toolgate` executable lands on your `PATH` via the `bin` field in `package.json`.

## Setup

```bash
toolgate init             # register the PreToolUse hook in ~/.claude/settings.json
toolgate init --project   # (optional) scaffold a project-specific config
```

`toolgate init` wires up the hook globally; the 74 built-in policies are active immediately. `toolgate init --project` creates a `toolgate.config.ts` and adds `toolgate.config.local.ts` to your project's `.gitignore`.

## Configuration

Toolgate walks from the current directory up to `$HOME` and loads every config it finds along the way. At each level it checks two filenames, in this order:

1. `toolgate.config.local.ts` — **personal, gitignored.** Policies for your machine that you don't want to commit.
2. `toolgate.config.ts` — **shared, committed.** Policies the whole team uses.

Both may live at the directory root or inside `.claude/`. Personal configs are evaluated before shared ones, and inner directories before outer ones, so the most specific/personal policy wins. Built-in policies always run last.

### Evaluation order

The engine partitions policies by their `action` field and **always runs `deny` policies before `allow` policies**, regardless of array order. This means a broad `allow` can never override a safety-critical `deny`. Within each group, policies run in load order. The **first policy to return a verdict wins**; if none do, Claude Code prompts you as normal.

### Disabling policies

A config can disable any named policy (built-in or inherited) via a `disable` export:

```ts
// toolgate.config.ts
export default [myPolicy];
export const disable = ["Deny bash grep"];
```

Names must match the policy's `name` field exactly; unknown names are ignored. Or use `toolgate disable` to toggle policies interactively (`--json` dumps the full policy state for debugging).

## Writing a policy

A policy is an object with a `name`, a `description`, an `action` (`"allow"` or `"deny"`), and an async `handler`. The handler's return value is its verdict:

| Return value | `action: "allow"` | `action: "deny"` |
|---|---|---|
| `true` | allow the call | deny the call (no reason) |
| a non-empty `string` | allow the call | deny the call, with the string as the reason |
| `false` / `undefined` / nothing | pass through to the next policy | pass through to the next policy |

```ts
import type { Policy } from "@brycehanscomb/toolgate";

const denyRmRf: Policy = {
  name: "Deny rm -rf",
  description: "Blocks destructive rm -rf commands",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "Bash") return; // pass through
    if (call.args.command?.includes("rm -rf")) {
      return "Destructive command blocked"; // deny with a reason
    }
  },
};

export default denyRmRf;
```

Register the policy in a config with `definePolicy([...])`. The first policy to return a verdict wins (deny policies are always evaluated first).

### The `ToolCall`

Each handler receives a `ToolCall`:

- `tool` — the tool name (`"Bash"`, `"Read"`, `"Write"`, `"Edit"`, …)
- `args` — the tool arguments (e.g. `{ command: "git status" }` for Bash)
- `context.cwd` — the working directory
- `context.projectRoot` — the git repository root
- `context.additionalDirs` — extra allowed directories
- `context.env` — environment variables
- `context.agentType` / `context.agentId` — the subagent type and id when the call comes from a subagent; `undefined` for main-agent calls

> **Bash policies:** don't match raw command strings with regex — commands can be chained, substituted, and redirected in ways a regex won't catch. Use the AST-based helpers instead. See **[Writing Bash policies](docs/bash-policies.md)**.

## Built-in policies

Toolgate ships **74** built-in policies across three tiers — `deny` (block dangerous patterns), `redirect` (block with a better suggestion), and `allow` (whitelist safe patterns). A representative sample:

| Policy | Effect |
|---|---|
| `Deny writes outside project` | Blocks file writes and Bash redirects targeting paths outside the project root |
| `Deny git add-and-commit` | Blocks compound `git add && git commit`, forcing separate steps |
| `Redirect plans to project` | Blocks plan writes to `~/.claude/plans/`, suggests project `docs/` instead |
| `Allow git status` / `Allow git diff` / `Allow git add` | Whitelist safe, read-mostly git commands |
| `Allow read in project` / `Allow edits in project` | Whitelist file reads and edits within the project root |
| `Allow WebFetch` / `Allow WebSearch` | Whitelist web tool calls |

Run **`toolgate list`** to see every loaded policy (built-ins plus your own) with names and descriptions, or browse [`policies/`](policies/) for the source.

## CLI

```bash
toolgate init [--project]        # register the hook / scaffold a project config
toolgate list                    # list every loaded policy
toolgate test [--why] <tool> [args-json]   # dry-run a tool call against your policies
toolgate audit [--json]          # audit a project's settings.local.json against policies
toolgate disable [--local|--shared|--file=<path>|--json]   # toggle disabled policies
toolgate hash <file...>          # print SHA-256 of files, for pinnedScripts() pins
toolgate migrate [paths] [--write]   # codemod legacy Middleware policies to the action API
toolgate suspend                 # temporarily suspend all policies (Ctrl+C to resume)
toolgate logs                    # print Claude Code log file locations
```

For example:

```bash
$ toolgate test --why Bash '{"command": "git add ."}'
ALLOW
  why: Allow git add (index 4)
  description: Permits git add commands, optionally piped through safe filters
```

## Further reading

- **[Writing Bash policies](docs/bash-policies.md)** — the AST helpers (`safeBashCommand`, `safeBashCommandOrPipeline`, `getAndChainSegments`, `isSafeFilter`, …) and why to use them.
- **[Pinning scripts](docs/pinning-scripts.md)** — `pinnedScripts()` verifies a whitelisted script's contents by SHA-256 on every run, so allowing `node query.mjs` doesn't blindly trust future rewrites.
- **[Subagent policies](docs/subagents.md)** — gating tool calls on *who* is calling with `isSubagent()` / `context.agentType`, plus the opt-in nested-spawn guard.
- **[The bridge](docs/bridge.md)** — a stdin/stdout entry point that lets non-Claude-Code agents (e.g. OpenCode) use toolgate's policy engine.

## License

MIT
