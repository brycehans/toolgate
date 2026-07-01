# The bridge (OpenCode / other agents)

Toolgate exposes a stdin/stdout bridge for non-Claude-Code consumers. This lets agents like [OpenCode](https://opencode.ai) use toolgate's policy engine through their own plugin hook systems. It reuses the exact same `buildToolCall` → `loadConfigs` → `runPolicy` pipeline as the Claude Code hook, so verdicts are identical.

## Usage

```bash
echo '{"tool":"Bash","args":{"command":"git push"},"cwd":"/path/to/repo"}' | bun run src/bridge.ts
# → {"verdict":"deny","reason":"git push requires approval"}
```

## Input format

```json
{
  "tool": "Bash",
  "args": { "command": "git status" },
  "cwd": "/path/to/project",
  "session_id": "optional-session-id"
}
```

- `tool` — the tool name (`"Bash"`, `"Read"`, `"Write"`, …)
- `args` — the tool arguments object
- `cwd` — the working directory (defaults to `process.cwd()`)
- `session_id` — optional session identifier

## Output format

```json
{"verdict":"allow"}
{"verdict":"deny","reason":"git push requires approval"}
{"verdict":"next"}
```

- `allow` — permit the tool call
- `deny` — block the tool call; `reason` explains why
- `next` — no policy matched; fall through to the agent's default handling

## OpenCode integration

Configure a `tool.execute.before` hook that pipes tool calls through the bridge:

```json
{
  "hooks": {
    "tool.execute.before": "echo '{\"tool\":\"$TOOL\",\"args\":$ARGS,\"cwd\":\"$CWD\"}' | bun run /path/to/toolgate/src/bridge.ts"
  }
}
```

The hook receives the tool call, toolgate evaluates the full policy chain (project configs + built-ins), and returns a verdict. If the verdict is `deny`, OpenCode blocks execution and surfaces the reason to the user.

## Notes

- Config resolution works identically to Claude Code (walks from `cwd` up to `$HOME`).
- JSON is written to stdout; errors go to stderr with a `deny` fallback on stdout, so a broken config fails closed.
