---
name: check-logs
description: Use when the user wants to see, analyze, or mine Claude Code permission requests - what tools are being prompted, which commands appear most, or what patterns need policies. Also use when asked about "what's being prompted", "permission log", "check logs", or "what should I allow"
---

# Permission Request Log

Claude Code logs every tool call that required user approval to `~/.claude/permission-requests.jsonl`. Each line is a JSON object:

```jsonc
{
  "session_id": "uuid",
  "transcript_path": "/Users/you/.claude/projects/.../session.jsonl",
  "cwd": "/Users/you/Dev/project",
  "permission_mode": "acceptEdits",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": { "command": "git status", "description": "..." }
}
```

A second log, `~/.claude/tool-failures.jsonl`, records tool calls that failed after execution (`PostToolUseFailure` events with exit codes and error messages).

## Quick Reference

| Goal | Command |
|------|---------|
| Top prompted tools | `jq -r '.tool_name' ~/.claude/permission-requests.jsonl \| sort \| uniq -c \| sort -rn` |
| Unique Bash commands | `jq -r 'select(.tool_name == "Bash") \| .tool_input.command \| split("\n")[0]' ~/.claude/permission-requests.jsonl \| sort -u` |
| Non-Bash tool patterns | `jq -r 'select(.tool_name \| test("Bash") \| not) \| "\(.tool_name) \| \(.tool_input \| keys \| join(", "))"' ~/.claude/permission-requests.jsonl \| sort \| uniq -c \| sort -rn` |
| Write/Edit file paths | `jq -c 'select(.tool_name == "Write" or .tool_name == "Edit") \| {tool: .tool_name, file: .tool_input.file_path}' ~/.claude/permission-requests.jsonl` |
| Filter by project | `jq -r 'select(.cwd \| startswith("/path/to/project")) \| .tool_name' ~/.claude/permission-requests.jsonl \| sort \| uniq -c \| sort -rn` |
| Filter by date (recent) | `tail -500 ~/.claude/permission-requests.jsonl \| jq -r '.tool_name' \| sort \| uniq -c \| sort -rn` |
| Live stream | `tail -f ~/.claude/permission-requests.jsonl \| jq -r '"\(.tool_name): \(.tool_input \| tostring \| .[0:120])"'` |

## Workflow

1. **Start broad** - run the "top prompted tools" query to see which tools dominate
2. **Drill into Bash** - extract unique commands to find clusters of similar patterns
3. **Look for clusters** - 3+ similar permission requests = strong signal for a new policy
4. **Filter by project** if the user wants project-specific analysis (use `.cwd` field)
5. **Check tool failures** (`tool-failures.jsonl`) for commands that fail repeatedly

## What to Look For

- **Same command prefix**: `git status`, `git diff`, `git log` -> git policy
- **Same tool with consistent args**: multiple `WebFetch` to same domain -> domain allowlist
- **Path patterns**: Write/Edit always within project root -> path-based policy
- **Dangerous compounds**: `git add . && git commit` -> deny policy

## Related

- `toolgate audit` compares `settings.local.json` rules against loaded policies (redundant/needed/denied)
- `toolgate suspend` live-streams permission requests with formatted output
