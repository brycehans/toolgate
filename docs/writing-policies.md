# Writing Toolgate Policies

A practical guide to crafting policies — from finding what to build, to testing edge cases, to shipping a polished result.

## 1. Start With Your Logs

The most effective way to discover what policies you need is to mine your actual Claude Code usage data. Two log files capture every permission decision Claude had to ask about:

| Log file | Event | What it tells you |
|---|---|---|
| `~/.claude/permission-requests.jsonl` | `PermissionRequest` | Every tool call that needed user approval |
| `~/.claude/tool-failures.jsonl` | `PostToolUseFailure` | Tool calls that failed after execution |

### Log entry structure

Each line is a JSON object with this shape:

```jsonc
{
  "session_id": "cbaf0fb7-...",
  "transcript_path": "/Users/you/.claude/projects/.../session.jsonl",
  "cwd": "/Users/you/Dev/myproject",
  "permission_mode": "acceptEdits",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": {
    "command": "git status",
    "description": "Show working tree status"
  }
}
```

The `tool_name` and `tool_input` fields are exactly what your policy's `call.tool` and `call.args` will receive. These log entries are ready-made test inputs.

### Mining techniques

**Frequency analysis** — find which tools generate the most permission prompts:

```bash
cat ~/.claude/permission-requests.jsonl \
  | jq -r '.tool_name' \
  | sort | uniq -c | sort -rn
```

```
 259 Bash
  95 Read
  91 Edit
  26 Write
  12 WebSearch
  11 WebFetch
   6 Agent
```

Bash dominates. That's where most policy work pays off.

**Extract unique commands** — see what specific Bash commands are being prompted:

```bash
cat ~/.claude/permission-requests.jsonl \
  | jq -r 'select(.tool_name == "Bash") | .tool_input.command | split("\n")[0]' \
  | sort -u
```

**Filter by non-Bash tools** — find patterns in Write, Edit, WebFetch, etc.:

```bash
cat ~/.claude/permission-requests.jsonl \
  | jq -r 'select(.tool_name | test("Bash") | not)
    | "\(.tool_name) | \(.tool_input | keys | join(", "))"' \
  | sort | uniq -c | sort -rn
```

**Extract file paths** from Write/Edit requests to find path patterns:

```bash
cat ~/.claude/permission-requests.jsonl \
  | jq -c 'select(.tool_name == "Write" or .tool_name == "Edit")
    | {tool: .tool_name, file: .tool_input.file_path}'
```

### What to look for

When scanning your logs, look for **clusters** — groups of similar commands that appear repeatedly:

- **Same command prefix**: `git status`, `git diff --cached`, `git log --oneline` → `allow-git-*` policies
- **Same tool with consistent args**: multiple `WebFetch` calls to `*.claude.com` → `allow-webfetch-claude`
- **Path patterns**: Write/Edit calls always within project root → `deny-writes-outside-project`
- **Dangerous compound patterns**: `git add . && git commit -m '...'` → `deny-git-add-and-commit`

A cluster of 3+ similar permission requests is a strong signal that a policy would help.

### Turn log entries into test data

Log entries translate directly into test cases. A permission request like:

```json
{"tool_name": "Bash", "tool_input": {"command": "bun test 2>&1 | tail -20"}}
```

becomes:

```ts
it("allows: bun test piped to tail", async () => {
  const result = await myPolicy.handler(bash("bun test 2>&1 | tail -20"));
  expect(result.verdict).toBe(ALLOW);
});
```

Collect a batch of related log entries. They become your "should allow" test suite. Then think about what *shouldn't* be allowed with the same prefix — those become your "should reject" tests.


## 2. Policy Anatomy

Every policy has the same shape:

```ts
import { allow, deny, next, type Policy } from "../src";

const myPolicy: Policy = {
  name: "My policy name",
  description: "One-line description of what this policy does",
  handler: async (call) => {
    // 1. Guard: return next() for tools/commands you don't handle
    if (call.tool !== "Bash") return next();

    // 2. Validate: check the tool's arguments
    // ... your logic here ...

    // 3. Decide: return allow(), deny(reason), or next()
    return allow();
  },
};
export default myPolicy;
```

### The three verdicts

| Verdict | Meaning | Effect |
|---|---|---|
| `allow()` | This call is safe | Silently permitted, no prompt shown |
| `deny(reason)` | This call is dangerous | Blocked with an error message |
| `next()` | I have no opinion | Passes to the next policy (eventually prompts the user) |

**First non-`next()` verdict wins.** Policy order matters — deny policies run before allow policies to catch dangerous patterns first.

### The `call` object

```ts
interface ToolCall {
  tool: string;                    // "Bash", "Write", "Edit", "WebFetch", etc.
  args: Record<string, any>;       // tool-specific arguments
  context: {
    cwd: string;                   // current working directory
    env: Record<string, string>;   // environment variables
    projectRoot: string;           // project root path
  };
}
```

Common `args` shapes by tool:

| Tool | Key args |
|---|---|
| `Bash` | `command: string`, `description?: string`, `timeout?: number` |
| `Write` | `file_path: string`, `content: string` |
| `Edit` | `file_path: string`, `old_string: string`, `new_string: string` |
| `Read` | `file_path: string`, `offset?: number`, `limit?: number` |
| `WebFetch` | `url: string`, `prompt: string` |
| `WebSearch` | `query: string` |
| `Glob` | `pattern: string`, `path?: string` |
| `Grep` | `pattern: string`, `path?: string`, `glob?: string` |


## 3. Policy Patterns

### Pattern A: Simple tool whitelist

The simplest policy — allow a set of tool names unconditionally:

```ts
const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskGet", "TaskList"]);

const allowTaskCrud: Policy = {
  name: "Allow Task CRUD",
  description: "Permits task management tool calls",
  handler: async (call) => {
    if (!TASK_TOOLS.has(call.tool)) return next();
    return allow();
  },
};
```

**When to use:** Tools that have no dangerous side effects regardless of arguments.

### Pattern B: Simple Bash command whitelist

Use `safeBashCommand()` to parse the command and check the executable name and args:

```ts
import { safeBashCommand } from "./parse-bash-ast";

const allowGitStatus: Policy = {
  name: "Allow git status",
  description: "Permits git status commands",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return next();
    if (tokens[0] === "git" && tokens[1] === "status") return allow();
    return next();
  },
};
```

`safeBashCommand()` returns `string[] | null`. It returns `null` (and you return `next()`) when:
- The tool isn't Bash
- The command has chaining (`&&`, `||`, `;`, newlines)
- The command has substitution (`$(...)`, backticks, `${...}`)
- The command has background execution (`&`)
- The command has unsafe redirects

This is your safety net. You only need to validate the command name and arguments.

### Pattern C: Bash command with pipeline support

Use `safeBashCommandOrPipeline()` when the command might pipe to filters like `grep`, `head`, `sort`:

```ts
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowGitLog: Policy = {
  name: "Allow git log",
  description: "Permits git log, optionally piped to safe filters",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] === "git" && tokens[1] === "log") return allow();
    return next();
  },
};
```

`safeBashCommandOrPipeline()` allows the first command to pipe through a whitelist of safe filters (`grep`, `head`, `tail`, `sort`, `uniq`, `wc`, `cut`, `tr`, etc.). It returns the **first command's tokens** — you validate the primary command, and the pipeline safety is handled for you.

### Pattern D: Path-scoped Bash command

When a command operates on file paths, validate they're within the project:

```ts
import { resolve } from "node:path";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowLsInProject: Policy = {
  name: "Allow ls in project",
  description: "Permits ls when all paths are within the project root",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] !== "ls") return next();
    if (!call.context.projectRoot) return next();

    const root = call.context.projectRoot;
    for (const arg of tokens.slice(1)) {
      if (arg.startsWith("-")) continue; // skip flags
      const resolved = resolve(call.context.cwd, arg);
      if (!resolved.startsWith(root + "/") && resolved !== root) return next();
    }

    return allow();
  },
};
```

**Critical:** Always resolve relative paths against `call.context.cwd` before comparing to `projectRoot`. Watch out for path traversal like `../../etc/passwd` or prefix tricks like `/home/user/project-evil`.

### Pattern E: Non-Bash tool validation

For tools like WebFetch, validate the arguments directly (no AST parsing needed):

```ts
const allowWebFetchClaude: Policy = {
  name: "Allow WebFetch claude.com",
  description: "Permits WebFetch requests to claude.com and subdomains",
  handler: async (call) => {
    if (call.tool !== "WebFetch") return next();

    const url = call.args.url;
    if (typeof url !== "string") return next();

    try {
      const parsed = new URL(url);
      if (parsed.hostname === "claude.com"
        || parsed.hostname.endsWith(".claude.com")) {
        return allow();
      }
    } catch {
      // invalid URL → pass through
    }

    return next();
  },
};
```

### Pattern F: Deny with helpful message

Deny policies should explain *why* and suggest an alternative:

```ts
const redirectPlansToProject: Policy = {
  name: "Redirect plans to project",
  description: "Blocks plan writes to ~/.claude/plans/, suggests project docs/ instead",
  handler: async (call) => {
    if (call.tool !== "Write" && call.tool !== "Edit") return next();
    if (!call.context.projectRoot) return next();

    const filePath = call.args.file_path;
    if (typeof filePath !== "string") return next();

    if (filePath.includes("/.claude/plans/")) {
      const docsDir = `${call.context.projectRoot}/docs`;
      return deny(`Plan files should be saved in the project. Write to ${docsDir}/ instead.`);
    }

    return next();
  },
};
```

The deny reason becomes Claude's error message. Make it actionable — tell Claude what to do instead.

### Pattern G: Advanced AST analysis

When `safeBashCommand()` is too restrictive, use `parseShell()` directly for custom AST analysis:

```ts
import { parseShell, findGitSubcommands } from "./parse-bash-ast";

const denyGitAddAndCommit: Policy = {
  name: "Deny git add-and-commit",
  description: "Blocks compound git add+commit commands",
  handler: async (call) => {
    if (call.tool !== "Bash") return next();
    if (typeof call.args.command !== "string") return next();

    const ast = await parseShell(call.args.command);
    if (!ast) return next();

    const subcommands = findGitSubcommands(ast);
    if (subcommands.includes("add") && subcommands.includes("commit")) {
      return deny("Split git add and git commit into separate steps");
    }

    return next();
  },
};
```

This scans across all statements in the AST (including chained commands) to detect the pattern, regardless of how the commands are joined.

### Pattern H: Multi-tool policies

Some safety rules apply to multiple tools. Handle each tool type in the same policy:

```ts
const denyWritesOutsideProject: Policy = {
  name: "Deny writes outside project",
  description: "Blocks file writes targeting paths outside the project root",
  handler: async (call) => {
    if (!call.context.projectRoot) return next();
    const root = call.context.projectRoot;

    // Handle Write and Edit tools
    if (call.tool === "Write" || call.tool === "Edit") {
      const filePath = call.args.file_path;
      if (typeof filePath !== "string") return next();
      if (!filePath.startsWith(root + "/") && filePath !== root) {
        return deny(`Write blocked: ${filePath} is outside project root`);
      }
      return next();
    }

    // Handle Bash redirects (>, >>, tee)
    if (call.tool === "Bash") {
      const ast = await parseShell(call.args.command);
      if (!ast) return next();
      // ... check findWriteRedirects(ast), findTeeTargets(ast) ...
    }

    return next();
  },
};
```


## 4. Using the AST Helpers

The `parse-bash-ast.ts` module provides typed access to Bash command structure via `shfmt --tojson`. Here's a reference for when to use each helper:

| Helper | Returns | Use when |
|---|---|---|
| `safeBashCommand(call)` | `string[] \| null` | Simple single command, no pipes needed |
| `safeBashCommandOrPipeline(call)` | `string[] \| null` | Command may pipe to safe filters |
| `parseShell(command)` | `ShellFile \| null` | Custom AST analysis needed |
| `getArgs(stmt)` | `string[] \| null` | Extract tokens from a single statement |
| `getPipelineCommands(stmt)` | `Stmt[] \| null` | Break a pipeline into individual commands |
| `isSafeFilter(tokens)` | `boolean` | Check if a piped command is a safe filter |
| `hasUnsafeNodes(obj)` | `boolean` | Check for substitution/expansion anywhere |
| `findWriteRedirects(file)` | `WriteRedirectInfo[]` | Find `>` and `>>` redirects |
| `findTeeTargets(file)` | `string[]` | Find `tee` output paths |
| `findGitSubcommands(file)` | `string[]` | Find git subcommands across all statements |
| `wordToString(word)` | `string \| null` | Extract literal string from AST word node |

### The safety hierarchy

```
safeBashCommand()           ← strictest: single command, no pipes, no redirects
safeBashCommandOrPipeline() ← allows pipes to safe filters
parseShell()                ← raw AST, you handle all safety checks yourself
```

Start with `safeBashCommand()`. Only move to `safeBashCommandOrPipeline()` if the command legitimately needs piping. Only use `parseShell()` when you need to inspect the AST structure beyond what the helpers provide (e.g., scanning across chained commands, checking redirect targets).

### Why you can't just split chains and validate each segment

It's tempting to think: "if `git status` is safe and `ls` is safe, then `git status && ls` should be safe too — just split on `&&` and check each part." This is **wrong** because earlier commands can change the execution context for later ones:

- **`cd /etc && cat passwd`** — `cd` changes the working directory, so `cat passwd` resolves to `/etc/passwd`. Each command individually looks harmless (a cd inside project, a cat of a relative path), but together they read outside the project.
- **`export PATH=/evil:$PATH && git status`** — an assignment changes the environment for subsequent commands.
- **`alias rm='cp -r' && rm secret /tmp/exfil`** — redefines a command for the rest of the chain.

This is why `safeBashCommand()` rejects all chaining, and why `allow-pure-and-chains` only allows `&&` chains where every segment is provably side-effect-free (no filesystem writes, no env/cwd mutation, no network). Commands like `cd`, `export`, `alias`, `source`, and anything that writes files are excluded from that allowlist by design. Pure functions compose safely; impure ones do not.


## 5. Writing Tests

### Test file structure

```ts
import { describe, expect, it } from "bun:test";
import { ALLOW, DENY, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import myPolicy from "../my-policy";

// Helper to construct a ToolCall for Bash
function bash(command: string, cwd = PROJECT, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot },
  };
}

const PROJECT = "/home/user/project";
```

Note: import from `"toolgate"` (package self-reference), not relative paths.

### Test categories to cover

**1. Happy path — commands that should be allowed:**

```ts
describe("allows safe commands", () => {
  const allowed = [
    "git status",
    "git status --short",
    "git status -sb",
    "git status | head -10",
  ];

  for (const cmd of allowed) {
    it(`allows: ${cmd}`, async () => {
      const result = await myPolicy.handler(bash(cmd));
      expect(result.verdict).toBe(ALLOW);
    });
  }
});
```

**2. Pass-through — commands you don't handle (should return `next()`):**

```ts
describe("passes through unrelated commands", () => {
  const passthrough = [
    "ls -la",
    "echo hello",
    "npm install",
  ];

  for (const cmd of passthrough) {
    it(`passes through: ${cmd}`, async () => {
      const result = await myPolicy.handler(bash(cmd));
      expect(result.verdict).toBe(NEXT);
    });
  }
});
```

**3. Rejection — commands that look similar but shouldn't be allowed:**

```ts
describe("rejects dangerous variations", () => {
  const rejected = [
    "git status && rm -rf /",      // chaining
    "git status; echo pwned",      // sequential
    "git status$(whoami)",          // substitution
    "git status `whoami`",         // backtick substitution
  ];

  for (const cmd of rejected) {
    it(`rejects: ${JSON.stringify(cmd)}`, async () => {
      const result = await myPolicy.handler(bash(cmd));
      expect(result.verdict).toBe(NEXT); // rejected by safeBashCommand
    });
  }
});
```

**4. False positives — things that mention the command but aren't it:**

```ts
describe("does not false-positive", () => {
  const allowed = [
    "echo 'git status'",           // string containing the command
    "git log --oneline | grep status",
  ];

  for (const cmd of allowed) {
    it(`passes through: ${cmd}`, async () => {
      const result = await myPolicy.handler(bash(cmd));
      expect(result.verdict).toBe(NEXT);
    });
  }
});
```

**5. Non-Bash tools — always pass through:**

```ts
it("passes through non-Bash tools", async () => {
  const call: ToolCall = {
    tool: "Read",
    args: { file_path: "/tmp/foo" },
    context: { cwd: "/tmp", env: {}, projectRoot: null },
  };
  const result = await myPolicy.handler(call);
  expect(result.verdict).toBe(NEXT);
});
```

**6. Context variations — different cwd and projectRoot values:**

```ts
it("rejects when cwd is outside project", async () => {
  const result = await myPolicy.handler(bash("find .", "/tmp", PROJECT));
  expect(result.verdict).toBe(NEXT);
});

it("passes through when no project root", async () => {
  const result = await myPolicy.handler(bash("find .", PROJECT, null));
  expect(result.verdict).toBe(NEXT);
});
```

### Using testPolicy() for integration tests

For testing how multiple policies interact (e.g., deny before allow), use the `testPolicy()` helper:

```ts
import { testPolicy } from "@brycehanscomb/toolgate";

await testPolicy([denyPolicy, allowPolicy], [
  { tool: "Bash", args: { command: "git add . && git commit -m 'x'" }, expect: "deny" },
  { tool: "Bash", args: { command: "git status" }, expect: "allow" },
  { tool: "Bash", args: { command: "curl example.com" }, expect: "ask" },
]);
```

### Run your tests

```bash
bun test policies/tests/my-policy.test.ts    # single policy
bun test policies/tests/                     # all policy tests
bun test                                     # everything
```


## 6. Registration

After writing your policy file and tests, register it in `policies/index.ts`:

```ts
import myNewPolicy from "./my-new-policy";

export const builtinPolicies = [
  // Deny policies (first)
  denyGitAddAndCommit,
  // ...

  // Allow policies (after denies)
  // ...
  myNewPolicy,  // ← insert at the correct position
];
```

**Ordering rules:**
1. **Deny policies** come first — they catch dangerous patterns before allows can whitelist them
2. **Redirect policies** come next — they modify behavior before evaluation
3. **Allow policies** come last — they whitelist known-safe patterns

A misplaced allow before a deny can override the safety check. Always insert at the correct position.


## 7. Dry-Run Testing

Use `toolgate test` to simulate a tool call against your full policy chain:

```bash
# Test a specific command
toolgate test Bash '{"command": "git status"}'

# See which policy made the decision
toolgate test --why Bash '{"command": "git status"}'
```


## 8. Checklist

Before shipping a policy:

- [ ] Mined `~/.claude/permission-requests.jsonl` for real examples
- [ ] Turned log entries into test cases (both allow and reject)
- [ ] Used `safeBashCommand()` or `safeBashCommandOrPipeline()` for Bash parsing (not regex)
- [ ] Validated paths against `call.context.projectRoot` where applicable
- [ ] Tested with `cwd` outside project root
- [ ] Tested with `projectRoot: null`
- [ ] Tested non-Bash tools pass through
- [ ] Tested compound commands (`&&`, `||`, `;`, `\n`) are rejected
- [ ] Tested substitution (`$(...)`, backticks, `${...}`) is rejected
- [ ] Checked for false positives (strings containing the command name)
- [ ] Deny messages are actionable (explain why *and* what to do instead)
- [ ] Registered in `policies/index.ts` at the correct position
- [ ] All tests pass: `bun test policies/tests/`
