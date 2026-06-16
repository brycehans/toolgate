# Session-Scoped Policies

**Issue:** [#6](https://github.com/brycehans/toolgate/issues/6)
**Date:** 2026-04-22

## Problem

Toolgate policies persist indefinitely in config files. Autonomous workflows (e.g. executing a test plan across staging/production) need temporary, targeted permissions. Current options are all bad: pre-approve broadly (too permissive), get prompted for each call (disruptive), or manually edit configs before/after (error-prone).

## Design

### Mechanism

Two environment variables let a Claude Code session opt into an additional policy file. The file is prepended to the policy chain with highest priority.

```bash
TOOLGATE_SESSION_FILE=/abs/path/to/session.ts TOOLGATE_SESSION_HASH=abc123... claude --continue
```

`seal` outputs a ready-to-use line:
```
$ toolgate session seal ./my-session.ts
TOOLGATE_SESSION_FILE=/absolute/path/to/my-session.ts TOOLGATE_SESSION_HASH=e3b0c44298fc...
```

### Security Model

**Threat:** An "evil Claude" could attempt to grant itself permissions via session policies.

**Defense:** The env vars are set by the user in the parent process before launching Claude. Claude cannot modify parent process environment variables — `export` in a Bash tool call dies with the subprocess. A SHA-256 content hash in `TOOLGATE_SESSION_HASH` prevents Claude from mutating the policy file mid-session. On every tool call, toolgate re-verifies the file hash against `TOOLGATE_SESSION_HASH`. Mismatch → the tool call is **denied** with an explicit error message ("session policy file has been modified"). This fails loudly so the user knows their session permissions are no longer active.

**Note on module caching:** The session policy file is loaded via `import()` once and cached by the runtime. The per-call hash check is a tamper-detection gate — it verifies the file hasn't changed, but does not re-execute the module. If the hash mismatches, the tool call is denied; the stale cached module is never used on mutated content.

**Threat model explored and rejected:**
- File sentinels — Claude can write any file
- Crypto signing with on-disk keys — Claude can read the key
- TTY prompts — Claude can fake via `tmux send-keys`, `screen`, `script -c`
- Deny policies on approval commands — Claude can obfuscate through subprocess, scripts, base64
- Env vars are the one trust boundary Claude cannot cross

### Hardening: `.env` injection

Bun auto-loads `.env` files from the working directory. Without mitigation, Claude could write `TOOLGATE_SESSION_FILE` and `TOOLGATE_SESSION_HASH` to a `.env` file and grant itself arbitrary permissions on the next tool call.

**Mitigation:** At runtime, before loading session policies, toolgate scans `.env*` files from cwd up to `$HOME` (matching the same directory walk as config loading). This includes all variants Bun auto-loads: `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.development.local`, `.env.production.local`. If `TOOLGATE_SESSION_FILE` or `TOOLGATE_SESSION_HASH` appears in any of these files, session policy loading is refused and the tool call is denied with an error explaining the `.env` injection attempt.

This is a runtime check, not a shebang flag — it works regardless of how toolgate is invoked (`toolgate run`, `bun src/cli.ts run`, etc.). Tests must verify that `.env`-sourced session vars are not honored.

**Defense-in-depth:** `cli.ts` should also use `#!/usr/bin/env -S bun --env-file=/dev/null` to disable `.env` auto-loading entirely. The runtime scan catches the session-specific attack; the shebang prevents the general class of `.env` injection for any future env-var-gated features.

### Security: session policy files are executable code

Session policy files are loaded via `import()`, which means they execute arbitrary TypeScript at load time — not just the exported policy array. A file with malicious top-level statements (network requests, file writes, etc.) will run on every tool call.

The `seal` command must warn the user: **"This file will be executed as code on every tool call. Review the entire file, not just the exported policies."** Users must audit for side effects, not just policy declarations.

### Flow

1. A policy file is written (by a skill, by hand — origin doesn't matter)
2. User reviews the file
3. User runs `toolgate session seal ./policy.ts`, copies the output, and launches: `TOOLGATE_SESSION_FILE=... TOOLGATE_SESSION_HASH=... claude --continue`
4. Toolgate prepends the session policies before all other policies
5. On every tool call, toolgate re-verifies the file hash. Mismatch → tool call denied.

**Tip:** To minimize the window between sealing and launching, combine into one line:
```bash
eval "$(toolgate session seal ./policy.ts)" claude --continue
```

### `toolgate session seal` CLI

Single new subcommand:

```
toolgate session seal <path>
```

- Validates the file exports a default array of policies (same as `loadConfigFile`)
- Computes SHA-256 of the file contents
- Prints a warning to stderr: `"⚠ This file will be executed as code on every tool call. Review the entire file, not just the exported policies."`
- Outputs a single line to stdout: `TOOLGATE_SESSION_FILE=<absolute-path> TOOLGATE_SESSION_HASH=<sha256>`
- User prepends this line to their `claude` command
- Rejects files that contain `import` or `require` statements targeting local paths (transitive imports escape the hash — only the entry file is hashed). Imports from `@brycehanscomb/toolgate` are allowed since they resolve to `node_modules`
- Warns if the file is inside a git worktree (subject to `git checkout`, editor auto-save, etc.)
- Exits non-zero if the file is invalid

### Changes to `loadConfigs`

At the top of `loadConfigs`, before the config walk:

1. Read `process.env.TOOLGATE_SESSION_FILE` and `process.env.TOOLGATE_SESSION_HASH`
2. If either is missing, skip session policy loading
3. Read the file, compute SHA-256, compare to `TOOLGATE_SESSION_HASH`
4. If match → load via `loadConfigFile`, prepend to policy array
5. If mismatch or file missing → throw a `SessionPolicyError` (a distinct error class) with reason: `"toolgate: session policy file has been modified (hash mismatch)"` or `"toolgate: session policy file not found"`. The `runner.ts` catch block converts thrown errors into deny verdicts — this throw is **load-bearing for security**. The distinct class lets callers (e.g. `test`, `list`) distinguish "config failed to load" from "session integrity violated."

Session policies go first → highest priority. Disable lists from project configs do not apply to session policies.

### Example Session Policy

```ts
import { allow, next, type Policy } from "@brycehanscomb/toolgate";
import { safeBashCommand } from "@brycehanscomb/toolgate/policies/parse-bash-ast";

const policies: Policy[] = [
  {
    name: "Session: allow WebFetch to staging",
    description: "Allow GET/POST to kosites-staging.io",
    handler: async (call) => {
      if (call.tool !== "WebFetch") return next();
      try {
        const hostname = new URL(call.args.url || "").hostname;
        if (hostname === "kosites-staging.io" || hostname.endsWith(".kosites-staging.io"))
          return allow();
      } catch {}
      return next();
    },
  },
  {
    name: "Session: allow gh issue edit #329",
    description: "Allow editing issue 329 on ko-sites",
    handler: async (call) => {
      // Always use safeBashCommand() for Bash policies — never regex on raw command strings.
      // Regex prefix checks allow command substitution in trailing args.
      const args = safeBashCommand(call);
      if (!args) return next();
      const [cmd, sub, num] = args;
      if (cmd === "gh" && sub === "issue" && ["edit", "comment"].includes(args[2]) && args[3] === "329")
        return allow();
      return next();
    },
  },
];

export default policies;
```

## Not In Scope

- No special directory convention — the file lives wherever you put it (though `/tmp/` is recommended over project directories to avoid git/editor interference)
- No session IDs — the env var points to a file, that's the identity
- No TTL / auto-cleanup — files are inert without the env var
- No proposal workflow — toolgate doesn't care who wrote the file
- No daemon / background process — toolgate stays stateless
- No changes to the `Policy` type — session policies are regular policies
- No multi-file support — one file per session
- No disable-list interaction — session policies can't be disabled by project configs, and can't disable other policies (can only add to the chain, not subtract)

## Implementation Scope

- ~15-line diff to `config.ts` (env var check, hash verify, prepend)
- New `seal` subcommand in `cli.ts`
- `SessionPolicyError` class in `src/`
- `cli.ts` shebang changed to `#!/usr/bin/env -S bun --env-file=/dev/null`
- Tests for: hash match (allow), hash mismatch (deny), file missing (deny), invalid file, prepend ordering, disable-list isolation, `.env`-sourced vars rejected (all `.env*` variants), `seal` prints code-execution warning, `seal` rejects files with local imports, `seal` warns on git worktree paths
