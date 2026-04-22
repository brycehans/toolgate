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

- **`types.ts`** — `ToolCall`, `CallContext`, `VerdictResult`, `Policy`, `PolicyHandler` type definitions
- **`verdicts.ts`** — Symbol-based verdict system: `ALLOW`, `DENY`, `NEXT` (internal — policy authors don't use these directly)
- **`adapter.ts`** — `adaptHandler()` converts simplified policy handler returns (truthy/void) into internal `VerdictResult` objects
- **`policy.ts`** — `definePolicy()` and `runPolicy()` — partitions policies by action (deny first, allow second), returns first activated verdict
- **`config.ts`** — Walks from cwd up to `$HOME` collecting configs. At each level, loads `toolgate.config.local.ts` (personal, gitignored) before `toolgate.config.ts` (committed, team-shared); prefers `./` over `./.claude/`. Built-in policies are appended last.
- **`runner.ts`** — Bridges Claude Code hook stdin/stdout protocol to the policy engine
- **`cli.ts`** — Subcommands: `run` (hook handler), `init` (setup), `test` (dry-run), `list` (show loaded policies)
- **`list-cmd.ts`** — Lists all loaded policies with names and descriptions
- **`testing.ts`** — `testPolicy()` assertion helper for policy test cases

### Built-in Policies (`policies/`)

Each policy is a `Policy` object with `name`, `description`, `action`, and `handler`.

- **`action: "deny"`** — handler returns a string (deny with reason), `true` (deny without reason), or `void` (pass through)
- **`action: "allow"`** — handler returns `true` (allow) or `void` (pass through)

The engine **always runs deny policies before allow policies**, regardless of array order. This prevents an overly broad allow from overriding a safety-critical deny. Within each action group, policies run in their original order.

Built-in policies are exported from `policies/index.ts` and automatically appended after any project-level policies. Project configs (`toolgate.config.ts`) can add extra policies via `definePolicy([...])`. First activated verdict wins.

### Disabling Policies

A config can disable any named policy (builtin or inherited from a parent config) via a named `disable` export:

```ts
// toolgate.config.ts
export default [myPolicy]
export const disable = ['Deny bash grep']
```

Names must match the `name` field on the target `Policy` exactly. Unknown names are silently ignored.

Use `toolgate disable` to interactively toggle policies on/off, or `toolgate disable --json` to dump the full policy state (names, sources, disable status) for debugging.

### Adding/Renaming Policies

When creating a new policy or renaming an existing one, you **must** update `policies/index.ts` to import and include it in the `builtinPolicies` array. A policy file that isn't registered in the index will have no effect.

### Key Patterns

- **Whitelist approach**: Policies explicitly allow known-safe patterns; everything else falls through (prompts user)
- **Shell command safety**: Use `shfmt --tojson` (via `policies/parse-bash-ast.ts`) to parse Bash commands into typed ASTs. Use `safeBashCommand()` for simple commands, `safeBashCommandOrPipeline()` for commands that may pipe to safe filters, or `getAndChainSegments()` to decompose `&&` chains into leaf statements. These reject unsafe patterns (substitution, chaining, background, unsafe redirects) at the AST level.
- **Self-imports in tests**: Policy tests import from `"@brycehanscomb/toolgate"` (package self-reference) instead of relative `../../../src` paths
- **Policy handlers are async**: All handlers return `Promise<string | boolean | void>`
- **Testing policy handlers**: Tests wrap handlers with `adaptHandler()` to get `VerdictResult` objects for assertions: `const run = adaptHandler(policy.action!, policy.handler as any)`

## Writing a Policy

```ts
import type { Policy } from "../src";

const myPolicy: Policy = {
  name: "My policy",
  description: "Describes what this policy does",
  action: "allow",  // or "deny"
  handler: async (call) => {
    if (call.tool !== "Bash") return;
    // ... validation logic ...
    return true;  // allow (for "allow" action) or deny (for "deny" action)
    // return "reason string" — only for "deny" action, denies with a message
    // return / return undefined — pass through to next policy
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

### Evaluation Order

The engine enforces **deny-before-allow** evaluation order automatically via the `action` field. Array position in `policies/index.ts` only affects relative order within the same action group.

- All `action: "deny"` policies run first — any truthy return short-circuits with a deny
- All `action: "allow"` policies run second — first truthy return allows
- If no policy activates, the user is prompted (ask)

This means a misplaced allow policy **cannot** override a deny policy, regardless of array order.

### When to Create a Built-in vs Leave as Static Rule

| Create a policy when... | Leave as static rule when... |
|---|---|
| 3+ related rules share a prefix | Single one-off command |
| Pattern is useful across projects | Deeply project-specific |
| Command can be safely parsed with `safeBashCommand` | Command is hard to scope safely (e.g., `xargs`) |
| You want deny semantics with a message | Simple allow is sufficient |

## Versioning

**Bump `version` in `package.json` before pushing to remote.** Every push must include a version bump — patch for fixes, minor for new policies or features, major for breaking changes. If you forget, the push should be rejected or amended.

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

## Managing Disabled Policies

Use `toolgate disable` to interactively toggle which policies are disabled in a config:

```bash
toolgate disable           # interactive TUI, edits nearest config
toolgate disable --local   # target toolgate.config.local.ts
toolgate disable --shared  # target toolgate.config.ts
toolgate disable --json    # dump all policies + disable state as JSON
```

The `--json` output includes each policy's name, description, source, disabled status, and which config disables it — useful for LLM-assisted debugging of policy behavior.
