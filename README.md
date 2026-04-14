# toolgate

A policy engine for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) tool permissions. Define policies that automatically allow, deny, or prompt for each tool call.

## Why

Claude Code asks permission before running tools like Bash commands, file writes, etc. Toolgate lets you codify your permission preferences as composable policies — so `git status` is always allowed, destructive commands are always denied, and everything else prompts as normal.

```ts
// toolgate.config.ts — auto-allow curl to localhost
import { definePolicy, allow, next } from "@brycehanscomb/toolgate";
import { safeBashCommand } from "toolgate/policies/parse-bash-ast";

export default definePolicy([
  {
    name: "Allow curl localhost",
    description: "Permits curl commands targeting localhost",
    handler: async (call) => {
      const args = await safeBashCommand(call);
      if (!args) return next();
      if (args[0] === "curl" && args.some((a) => /^https?:\/\/localhost/.test(a))) {
        return allow();
      }
      return next();
    },
  },
]);
```

## Install

### Prerequisites

Toolgate requires [shfmt](https://github.com/mvdan/sh) for Bash command parsing. Without it, all Bash commands will prompt for permission.

```bash
# With Homebrew
brew install shfmt

# Or with Go (ensure ~/go/bin is in your PATH)
go install mvdan.cc/sh/v3/cmd/shfmt@latest
```

### Package

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

This registers a `PreToolUse` hook in `~/.claude/settings.json`. Toolgate ships with [50 built-in policies](#built-in-policies) that are always active.

## Configuration

Toolgate walks from the current directory up to `$HOME` and loads every config it finds along the way. At each level it checks two filenames, in this order:

1. `toolgate.config.local.ts` — **personal, gitignored.** For policies specific to your machine or setup that you don't want to commit.
2. `toolgate.config.ts` — **shared, committed.** For policies the whole team uses.

Both may live at the directory root or inside `.claude/`. Personal configs are evaluated before shared ones, and inner directories are evaluated before outer ones, so the most specific/personal policy wins. Built-in policies always run last.

`toolgate init --project` creates the shared config and adds `toolgate.config.local.ts` to your project's `.gitignore`.

Example shared config:

```ts
import { definePolicy, deny, next } from "@brycehanscomb/toolgate";

export default definePolicy([
  {
    name: "Deny dangerous commands",
    description: "Blocks rm -rf",
    handler: async (call) => {
      if (call.tool === "Bash" && call.args.command?.includes("rm -rf")) {
        return deny("Destructive command blocked");
      }
      return next();
    },
  },
]);
```

Project policies run first (personal before shared), then built-in. The first non-`next()` verdict wins.

## Writing Policies

A policy is an object with `name`, `description`, and an async `handler` function:

```ts
import { allow, deny, next, type Policy } from "@brycehanscomb/toolgate";

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

When writing policies for Bash commands, don't parse raw strings with regex — use the AST-based utilities from `policies/parse-bash-ast.ts` instead. They use `shfmt --tojson` under the hood and reject unsafe patterns (substitution, chaining, background, unsafe redirects) at the AST level.

```ts
import { safeBashCommand } from "toolgate/policies/parse-bash-ast";
import { allow, next, type Policy } from "@brycehanscomb/toolgate";

const allowMake: Policy = {
  name: "Allow make",
  description: "Permits simple make commands",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return next();
    if (tokens[0] === "make") return allow();
    return next();
  },
};
```

#### `safeBashCommand(call)`

Parses a Bash tool call into a flat `string[]` of tokens. Returns `null` if the command contains pipes, shell operators (`&&`, `||`, `;`, `&`), command substitution, unsafe redirects, or multiple statements. Use this for simple, single-command policies.

#### `safeBashCommandOrPipeline(call)`

Like `safeBashCommand`, but allows pipes to safe filters. Returns `string[]` — the tokens of the **first** command only (filter safety is validated automatically). Returns `null` for non-pipe operators or unsafe patterns. Use this when you need to allow commands like `git log | head`.

```ts
import { safeBashCommandOrPipeline } from "toolgate/policies/parse-bash-ast";

const tokens = await safeBashCommandOrPipeline(call);
if (!tokens) return next();
if (tokens[0] === "git") return allow();
```

#### `isSafeFilter(tokens)`

Returns `true` if a token array is a safe pipe filter — a command that only reads stdin and writes stdout. Safe filters: `grep`, `egrep`, `fgrep`, `head`, `tail`, `wc`, `cat`, `tr`, `cut`, `sort` (without `-o`), `uniq`.

#### `findGitRoot(cwd)`

Returns the git repository root for the given directory, or `null` if not in a repo. Exported from `toolgate/utils`.

See [`policies/allow-git-add.ts`](policies/allow-git-add.ts) for a full hardened example.

## CLI

```bash
# Dry-run a tool call against your policies
toolgate test Bash '{"command": "git add ."}'
# → ALLOW

# Show which policy matched and why
toolgate test --why Bash '{"command": "git add ."}'
# → ALLOW
#   why: Allow git add (index 4)
#   description: Permits git add commands, optionally piped through safe filters

# List all loaded policies
toolgate list

# Audit settings.local.json against policies
toolgate audit
toolgate audit --json

# Temporarily suspend all policies (Ctrl+C to resume)
toolgate suspend
```

## Built-in Policies

Toolgate ships with 50 built-in policies organized in three tiers. Order matters — first non-`next()` verdict wins.

### Deny (block dangerous patterns first)

| Policy | Description |
|--------|-------------|
| `deny-git-add-and-commit` | Blocks compound git add+commit, forcing separate steps |
| `deny-writes-outside-project` | Blocks writes, redirects, cp/mv/install targeting paths outside the project |
| `deny-git-dash-c` | Blocks `git -C` configuration injection |
| `deny-bash-grep` | Rejects grep/rg in Bash — use the built-in Grep tool instead |
| `deny-cd-chained` | Blocks cd chained with other commands |
| `deny-git-chained` | Blocks git commands chained with non-git commands |
| `deny-gh-heredoc` | Prevents heredoc/command substitution in gh/git commands |

### Redirect

| Policy | Description |
|--------|-------------|
| `redirect-plans-to-project` | Blocks plan writes to `~/.claude/plans/` and suggests project `docs/` instead |

### Allow (whitelist safe patterns)

**Git & GitHub**

| Policy | Description |
|--------|-------------|
| `allow-git-add` | Permits `git add` with safe arguments |
| `allow-git-diff` | Permits `git diff`, optionally piped through safe filters |
| `allow-git-log` | Permits `git log` and `git show`, optionally piped |
| `allow-git-status` | Permits `git status`, optionally piped |
| `allow-git-branch` | Permits read-only `git branch` commands |
| `allow-git-checkout-b` | Permits `git checkout -b` / `git switch -c` |
| `allow-git-stash` | Permits safe `git stash` operations |
| `allow-git-worktree` | Permits `git worktree` add/list/move/remove/prune |
| `allow-git-check-ignore` | Permits `git check-ignore` |
| `allow-git-rev-parse` | Permits `git rev-parse` |
| `allow-git-local-repo` | Permits git commands in local repos |
| `allow-gh-read-only` | Permits read-only `gh` CLI commands (view, list, diff, checks, search) |

**File Operations**

| Policy | Description |
|--------|-------------|
| `allow-read-in-project` | Permits `Read` tool for files within project root |
| `allow-edit-in-project` | Permits `Edit`, `Write`, `Update` for files in project (except sensitive files) |
| `allow-grep-in-project` | Permits `Grep` tool within project root |
| `allow-search-in-project` | Permits `Search` and `Glob` within project root |
| `allow-find-in-project` | Permits `Find` tool within project root |
| `allow-mkdir-in-project` | Permits `mkdir` within project root |

**Bash & Shell**

| Policy | Description |
|--------|-------------|
| `allow-bun-test` | Permits `bun test`, optionally piped |
| `allow-bash-find-in-project` | Permits `find` commands within project root |
| `allow-ls-in-project` | Permits `ls` within project root |
| `allow-cd-in-project` | Permits `cd` within project root |
| `allow-safe-read-commands` | Permits read-only commands (cat, head, tail, wc, etc.) in project |
| `allow-pure-and-chains` | Auto-allows `&&` chains where every segment is independently safe |
| `allow-rm-project-tmp` | Permits `rm` in project tmp/ directories |
| `allow-sleep` | Permits `sleep` with numeric duration |
| `allow-read-plugin-cache` | Permits reads from plugin cache directories |

**Claude Code Tools**

| Policy | Description |
|--------|-------------|
| `allow-explore-in-project` | Permits Explore agent within project root |
| `allow-plan-in-project` | Permits Plan tool within project root |
| `allow-agent` | Permits Agent subagent invocations |
| `allow-task-crud` | Permits Task tool calls (create, update, list, get) |
| `allow-task-create` | Permits TaskCreate tool calls |
| `allow-cron-crud` | Permits CronCreate, CronDelete, CronList |
| `allow-ask-user` | Permits AskUserQuestion |
| `allow-plan-mode` | Permits EnterPlanMode and ExitPlanMode |
| `allow-tool-search` | Permits ToolSearch |
| `allow-superpowers-skills` | Permits superpowers skill invocations |

**Web & MCP**

| Policy | Description |
|--------|-------------|
| `allow-web-fetch` | Permits all WebFetch tool calls |
| `allow-web-search` | Permits all WebSearch tool calls |
| `allow-webfetch-claude` | Permits WebFetch to claude.com and subdomains |
| `allow-mcp-context7` | Permits Context7 documentation lookup calls |
| `allow-mcp-ide-diagnostics` | Permits IDE diagnostics tool calls |

## License

MIT
