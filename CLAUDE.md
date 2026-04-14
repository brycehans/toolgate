# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Toolgate is a policy engine for Claude Code's PreToolUse hooks. It intercepts tool calls and makes permission decisions (allow/deny/ask) based on configurable policies.

## Commands

```bash
bun test                              # run all tests
bun test src/                         # run core tests only
bun test policies/tests/              # run policy tests only
bun test <path/to/file.test.ts>       # run a single test file
bun install                           # install dependencies
```

Use Bun exclusively — not Node.js, npm, yarn, or pnpm. Bun auto-loads `.env`.

## Architecture

**Data flow:** Claude Code hook (stdin JSON) → `cli.ts run` → `buildToolCall()` → `loadConfigs()` → `runPolicy()` policy chain → hook response (stdout JSON)

### Core (`src/`)

- **`types.ts`** — `ToolCall`, `CallContext`, `VerdictResult`, `Middleware`, `Policy` type definitions
- **`verdicts.ts`** — Symbol-based verdict system: `ALLOW`, `DENY`, `NEXT` with helpers `allow()`, `deny(reason?)`, `next()`
- **`policy.ts`** — `definePolicy()` and `runPolicy()` — sequential policy chain, returns first non-NEXT verdict
- **`config.ts`** — Walks from cwd up to `$HOME` collecting configs. At each level, loads `toolgate.config.local.ts` (personal, gitignored) before `toolgate.config.ts` (committed, team-shared); prefers `./` over `./.claude/`. Built-in policies are appended last.
- **`runner.ts`** — Bridges Claude Code hook stdin/stdout protocol to the policy engine
- **`cli.ts`** — Subcommands: `run` (hook handler), `init` (setup), `test` (dry-run), `list` (show loaded policies)
- **`list-cmd.ts`** — Lists all loaded policies with names and descriptions
- **`testing.ts`** — `testPolicy()` assertion helper for policy test cases

### Built-in Policies (`policies/`)

Each policy is a `Policy` object with `name`, `description`, and `handler`. The handler is a `Middleware` function that returns `next()` to pass through, `allow()` to permit, or `deny(reason)` to block.

Built-in policies are exported from `policies/index.ts` and automatically appended after any project-level policies. Project configs (`toolgate.config.ts`) can add extra policies via `definePolicy([...])`. Order matters — first non-NEXT verdict wins.

### Adding/Renaming Policies

When creating a new policy or renaming an existing one, you **must** update `policies/index.ts` to import and include it in the `builtinPolicies` array. A policy file that isn't registered in the index will have no effect.

### Key Patterns

- **Whitelist approach**: Policies explicitly allow known-safe patterns; everything else falls through as `next()` (prompts user)
- **Shell command safety**: Use `shfmt --tojson` (via `policies/parse-bash-ast.ts`) to parse Bash commands into typed ASTs. Use `safeBashCommand()` for simple commands, `safeBashCommandOrPipeline()` for commands that may pipe to safe filters, or `getAndChainSegments()` to decompose `&&` chains into leaf statements. These reject unsafe patterns (substitution, chaining, background, unsafe redirects) at the AST level.
- **Self-imports in tests**: Policy tests import from `"toolgate"` (package self-reference) instead of relative `../../../src` paths
- **Policy handlers are async**: All handlers return `Promise<VerdictResult>`
- **Testing policy handlers directly**: Policy tests call `policyObj.handler(call)` to test the handler function

## Writing a Policy

```ts
import { allow, next, type Policy } from "../src";

const myPolicy: Policy = {
  name: "My policy",
  description: "Describes what this policy does",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    // ... validation logic ...
    return allow();
  },
};
export default myPolicy;
```

For Bash policies that parse commands, use the AST helpers in `policies/parse-bash-ast.ts`:
- `safeBashCommand(call)` — returns `string[] | null` args for a single safe command
- `safeBashCommandOrPipeline(call)` — same but allows pipes to safe filters (grep, head, sort, etc.)
- `parseShell(command)` — low-level: returns the full shfmt AST for custom analysis
- These automatically reject command chaining, substitution, unsafe redirects, and background execution

## Policy Placement

**Built-in policies** (`policies/`) are general-purpose and apply across all projects. Examples: git commands, shell utilities, node package managers, docker.

**Project policies** (`toolgate.config.ts`) are repo-specific. Examples: Laravel artisan commands, project-specific WebFetch domains, custom build scripts.

### Ordering Convention

The `builtinPolicies` array in `policies/index.ts` follows this order:

1. **Deny policies** — catch dangerous patterns first (`deny-git-add-and-commit`, `deny-writes-outside-project`, `deny-git-dash-c`)
2. **Redirect policies** — modify tool calls before evaluation (`redirect-plans-to-project`)
3. **Allow policies** — whitelist safe patterns (all `allow-*` policies)

New policies must be inserted at the correct position. First non-`next()` verdict wins, so a misplaced allow could override a deny.

### When to Create a Built-in vs Leave as Static Rule

| Create a policy when... | Leave as static rule when... |
|---|---|
| 3+ related rules share a prefix | Single one-off command |
| Pattern is useful across projects | Deeply project-specific |
| Command can be safely parsed with `safeBashCommand` | Command is hard to scope safely (e.g., `xargs`) |
| You want deny semantics with a message | Simple allow is sufficient |

## Gotchas

**Never remove an import before replacing its usages in a toolgate config.** If the config file has a syntax/reference error, toolgate evaluation itself fails — which blocks *all* subsequent tool calls (including the ones needed to finish the fix). Always replace usages first, then clean up the import, or do both in a single edit.

## Auditing Permissions

Use `toolgate audit` to analyze a project's `settings.local.json` against loaded policies:

```bash
cd /path/to/project
toolgate audit          # table format
toolgate audit --json   # machine-readable
```

This identifies redundant rules (already covered by policies), needed rules (candidates for new policies), and denied rules (conflicts with deny policies).
