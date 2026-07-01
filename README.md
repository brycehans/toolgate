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

Install by cloning the repository and linking a local checkout:

```bash
git clone git@github.com:brycehans/toolgate.git
cd toolgate
bun install
bun link
```

`bun link` puts the `toolgate` executable on your PATH via the `bin` field in `package.json`.

## Setup

```bash
# Register the PreToolUse hook globally
toolgate init

# Optionally, create a project-specific config
toolgate init --project
```

This registers a `PreToolUse` hook in `~/.claude/settings.json`. Toolgate ships with [62 built-in policies](#built-in-policies) that are always active.

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

### Disabling Policies

A config can disable any named policy (built-in or inherited from a parent config) via a named `disable` export:

```ts
// toolgate.config.ts
export default [myPolicy]
export const disable = ['Deny bash grep']
```

Names must match the `name` field on the target `Policy` exactly. Use `toolgate disable` to interactively toggle policies on/off, or `toolgate disable --json` to dump the full policy state for debugging.

### Pinning Scripts

Whitelisting a command like `node query.mjs` or `./deploy.sh` trusts the script's **path**, not its **contents**. Once you've audited the script and written the allow rule, that rule keeps approving the path even after the file is rewritten — by a dependency, by the agent under an "allow project edits" policy, by anything. This actually *widens* the blast radius of ordinary edit-allow policies: editing a script is cheap-and-allowed, and then running the edited script is allowed too.

`pinnedScripts()` closes the gap. Record a script's SHA-256 when you audit it; toolgate re-verifies it on every run. Any drift is denied with a re-audit hint.

```ts
import { definePolicy, pinnedScripts } from "@brycehanscomb/toolgate";

export default definePolicy([
  pinnedScripts({
    "query.mjs": "7ef35f032598dd6024ee2da515d9361880d79b81f432694f6d233aab6e2b1c69",
    "db.mjs":    "…",
  }),
  // …your existing allow policies, unchanged…
]);
```

Record or update a pin with [`toolgate hash`](#cli):

```bash
toolgate hash query.mjs db.mjs
# 7ef35f03…  query.mjs
# a1b2c3d4…  db.mjs
```

Pin keys are resolved relative to the project root (absolute paths also work). The expected hash may optionally carry a `sha256:` prefix.

**How it composes:** `pinnedScripts()` returns a `deny` policy, and the engine always runs deny policies before allow policies. So it slots in as one extra entry and gates your existing allow rules *without modifying them* — matching scripts still auto-approve; a drifted (or missing) script is blocked first. It only fires on scripts that are actually **executed** (an interpreter's first positional argument, e.g. `node <script>`, or a directly-run `./script`), so a script merely referenced as data — `cat query.mjs`, `grep foo query.mjs` — is never affected.

The building blocks are also exported directly: `hashFile(absPath)` returns a file's SHA-256 (or `null` if unreadable), and `fileMatchesHash(absPath, expected)` compares against a recorded pin.

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
- `context.agentType` — the subagent type (e.g. `"Explore"`, `"general-purpose"`) when the call originates from a subagent; `undefined` for main-agent calls
- `context.agentId` — the subagent's id when applicable; `undefined` otherwise

### Subagent-specific rules

Subagents (dispatched via the `Agent` tool) run their own tool calls through the same policy chain as the main agent, so **every policy already applies to them**. In addition, you can write policies that gate on _who_ is calling — allowing or denying a call specifically because it comes from a subagent — using `context.agentType` or the `isSubagent(call)` helper:

```ts
import { isSubagent, deny, next, type Policy } from "@brycehanscomb/toolgate";

const denySubagentPush: Policy = {
  name: "Deny subagent git push",
  description: "Subagents may not push to remotes",
  handler: async (call) => {
    if (!isSubagent(call)) return next();
    if (call.tool === "Bash" && call.args.command?.startsWith("git push")) {
      return deny(`Subagent (${call.context.agentType}) may not push`);
    }
    return next();
  },
};
```

Toolgate ships one such policy as an **opt-in** example, [`deny-nested-subagent-spawn`](policies/deny-nested-subagent-spawn.ts), which stops a subagent from spawning further subagents (capping agent nesting at one level). It is intentionally _not_ a built-in — enable it by importing it into a config:

```ts
import { definePolicy } from "@brycehanscomb/toolgate";
import denyNestedSubagentSpawn from "@brycehanscomb/toolgate/policies/deny-nested-subagent-spawn";

export default definePolicy([denyNestedSubagentSpawn]);
```

> **Note:** the hook payload exposes _whether_ the caller is a subagent, but not the numeric nesting depth or a parent-agent pointer — so the enforceable limit is "one level," not an arbitrary depth.

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

#### `getAndChainSegments(file)`

Decomposes `&&`-chained commands into individual `Stmt` nodes. Returns `null` if the command contains `||`, `;`, or other unsafe operators. Use this when you need to validate each segment of a compound command independently (e.g. `allow-pure-and-chains`).

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

# Interactively toggle which policies are disabled
toolgate disable
toolgate disable --local   # target toolgate.config.local.ts
toolgate disable --shared  # target toolgate.config.ts
toolgate disable --json    # dump all policies + disable state as JSON

# Print the SHA-256 of files, for recording pinnedScripts({...}) pins
toolgate hash query.mjs db.mjs

# Temporarily suspend all policies (Ctrl+C to resume)
toolgate suspend
```

## Bridge (OpenCode / Other Agents)

Toolgate exposes a stdin/stdout bridge for non-Claude-Code consumers. This lets agents like OpenCode use toolgate's policy engine via their plugin hook systems.

### Usage

```bash
echo '{"tool":"Bash","args":{"command":"git push"},"cwd":"/path/to/repo"}' | bun run src/bridge.ts
# → {"verdict":"deny","reason":"git push requires approval"}
```

### Input Format

```json
{
  "tool": "Bash",
  "args": { "command": "git status" },
  "cwd": "/path/to/project",
  "session_id": "optional-session-id"
}
```

- `tool` — tool name (`"Bash"`, `"Read"`, `"Write"`, etc.)
- `args` — tool arguments object
- `cwd` — working directory (defaults to `process.cwd()`)
- `session_id` — optional session identifier

### Output Format

```json
{"verdict":"allow"}
{"verdict":"deny","reason":"git push requires approval"}
{"verdict":"next"}
```

- `allow` — permit the tool call
- `deny` — block the tool call; `reason` explains why
- `next` — no policy matched; fall through to the agent's default handling

### OpenCode Integration

In OpenCode, configure a `tool.execute.before` hook that pipes tool calls through the bridge:

```json
{
  "hooks": {
    "tool.execute.before": "echo '{\"tool\":\"$TOOL\",\"args\":$ARGS,\"cwd\":\"$CWD\"}' | bun run /path/to/toolgate/src/bridge.ts"
  }
}
```

The hook receives the tool call, toolgate evaluates the full policy chain (project configs + built-ins), and returns a verdict. If the verdict is `deny`, OpenCode blocks execution and surfaces the reason to the user.

### Implementation Notes

- Config resolution works identically to Claude Code (walks from `cwd` to `$HOME`)
- Outputs JSON on stdout; errors go to stderr with a `deny` fallback on stdout
- Reuses the same `buildToolCall`, `loadConfigs`, and `runPolicy` pipeline

## Built-in Policies

Toolgate ships with 62 built-in policies organized in three tiers. Order matters — first non-`next()` verdict wins.

### Deny (block dangerous patterns first)

| Policy | Description |
|--------|-------------|
| `deny-git-add-and-commit` | Blocks compound git add+commit, forcing separate steps |
| `deny-writes-outside-project` | Blocks writes, redirects, cp/mv/install targeting paths outside the project |
| `deny-git-dash-c` | Blocks `git -C` configuration injection |
| `deny-cd-chained` | Blocks cd chained with other commands |
| `deny-git-chained` | Blocks git commands chained with non-git commands |
| `deny-gh-heredoc` | Prevents heredoc/command substitution in gh/git commands |
| `deny-ssh-compound` | Rejects compound Bash commands containing ssh — run ssh separately for explicit approval |
| `deny-mixed-pure-chains` | Blocks compound commands mixing pure (sleep, echo) and non-pure commands |

### Redirect

| Policy | Description |
|--------|-------------|
| `redirect-plans-to-project` | Blocks plan writes to `~/.claude/plans/` and suggests project `docs/` instead |
| `redirect-python-json-to-fx` | Blocks python3 JSON processing commands — suggests `fx`/`gron` instead |

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
| `allow-git-commit` | Permits standalone `git commit` (chained add+commit is caught by deny policy) |
| `allow-git-stash` | Permits safe `git stash` operations |
| `allow-git-worktree` | Permits `git worktree` add/list/move/remove/prune |
| `allow-git-check-ignore` | Permits `git check-ignore` |
| `allow-git-rev-parse` | Permits `git rev-parse` |
| `allow-git-local-repo` | Permits git commands in local repos |
| `allow-non-destructive-git` | Auto-approves git commands that don't mutate remote state or discard uncommitted work |
| `allow-gh-read-only` | Permits read-only `gh` CLI commands (view, list, diff, checks, search) |
| `allow-gh-issue-pr` | Permits `gh issue` and `gh pr` subcommands (create, edit, comment, close, reopen) but denies delete |

**File Operations**

| Policy | Description |
|--------|-------------|
| `allow-read-in-project` | Permits `Read` tool for files within project root |
| `allow-edit-in-project` | Permits `Edit`, `Write`, `Update` for files in project (except sensitive files) |
| `allow-grep-in-project` | Permits `Grep` tool within project root |
| `allow-bash-grep-in-project` | Permits grep/egrep/fgrep/rg commands when all paths are within project root |
| `allow-search-in-project` | Permits `Search` and `Glob` within project root |
| `allow-find-in-project` | Permits `Find` tool within project root |
| `allow-mkdir-in-project` | Permits `mkdir` within project root |
| `allow-read-tool-results` | Permits Read tool calls targeting `~/.claude/projects/*/tool-results/` |

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
| `allow-npm-install` | Permits npm install, pnpm install, and yarn install commands |
| `allow-npx-safe` | Permits npx commands for whitelisted packages (playwright, vitest, etc.) |
| `allow-tmux` | Auto-allows read-only tmux commands; for send-keys, evaluates inner command through the policy chain |
| `allow-aws-cli` | Auto-allows non-destructive AWS CLI commands with ReadOnly profiles; requires approval for Admin profiles |
| `allow-brew` | Auto-allows read-only brew commands (list, info, search, etc.); requires approval for mutating commands |

**Claude Code Tools**

| Policy | Description |
|--------|-------------|
| `allow-explore-in-project` | Permits Explore agent within project root |
| `allow-plan-in-project` | Permits Plan tool within project root |
| `allow-agent` | Permits Agent subagent invocations |
| `allow-task-crud` | Permits Task tool calls (create, update, list, get) |
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
| `allow-mcp-playwright` | Permits all Playwright browser automation tool calls |

## License

MIT
