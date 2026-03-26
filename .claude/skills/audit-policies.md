---
name: audit-policies
description: Analyze a project's Claude Code permission settings and suggest toolgate policies. Use when the user asks to audit, review, or optimize their Claude Code permissions.
---

# Audit Policies Skill

You are helping the user audit their Claude Code permission settings and suggest toolgate policies to replace static permission rules.

## Step 1: Run the Audit

Run `toolgate audit` from the user's project directory:

```bash
toolgate audit
```

This scans all Claude Code settings files (project and user-level), tests each permission rule against loaded toolgate policies, and categorizes them:

- **🟢 REDUNDANT** — already handled by a toolgate policy, safe to remove
- **🔴 DENIED** — a toolgate deny policy would block this, may indicate a conflict
- **🟡 NEEDED** — no policy covers this, candidate for a new toolgate policy
- **⚪ UNPARSED** — rule format couldn't be tested (manually review)

## Step 2: Clean Up Redundant Rules

For any REDUNDANT rules, offer to remove them from `settings.local.json`. These provide no value since toolgate already handles them.

## Step 3: Analyze NEEDED Rules for Policy Candidates

Group the NEEDED rules by the categories shown in the audit output. For each group with 3+ rules, suggest a toolgate policy.

### Policy Authoring Guidelines

**Where to put policies:**
- **Built-in** (`~/Dev/toolgate/policies/`) — general-purpose, useful across any project (git, docker, node, shell utilities)
- **Project** (`toolgate.config.ts`) — repo-specific (Laravel, custom scripts, project-specific WebFetch domains)

**Ordering convention:**
1. Deny policies first (catch dangerous patterns before allows)
2. Redirect policies (modify tool calls)
3. Allow policies (whitelist safe patterns)

**Safety for Bash policies:**
- Always use `safeBashTokens(call)` from `policies/parse-bash.ts` to parse commands
- This rejects command chaining (`&&`, `||`, `;`), shell substitution (`$()`, backticks), and multiline commands
- Never use regex directly on `call.args.command` for allow policies — only for deny policies where false positives are safe

**Policy template:**
```ts
import { allow, next, type Policy } from "../src";
import { safeBashTokens } from "./parse-bash";

const myPolicy: Policy = {
  name: "Allow X commands",
  description: "Permits X commands without chaining or substitution",
  handler: async (call) => {
    const tokens = safeBashTokens(call);
    if (!tokens) return next();

    if (tokens[0] === "mycommand") return allow();

    return next();
  },
};
export default myPolicy;
```

**When NOT to create a policy:**
- Single one-off rules (e.g., `Bash(./setup.sh)`) — leave as static rules
- MCP tools with no pattern (e.g., `mcp__sentry__get_issue_details`) — leave as static
- Commands that are hard to make safe (e.g., `xargs` executes arbitrary commands)

## Step 4: Write Policies

For each suggested policy:

1. Create the policy file in the appropriate location
2. If it's a built-in, register it in `policies/index.ts` (imports + array entry)
3. Verify with `toolgate test --why Bash '{"command": "example"}'`
4. Remove the corresponding rules from `settings.local.json`

## Step 5: Verify

Run `toolgate audit` again to confirm no regressions — all previously REDUNDANT and newly covered rules should show as 🟢.

## Notes

- Use `toolgate audit --json` for machine-readable output
- Use `toolgate test --why <tool> '<args>'` to test individual commands
- Use `toolgate list` to see all loaded policies
- The audit tests rules by generating a sample tool call — edge cases in wildcard rules (`:*`) may not be fully covered by a single sample
