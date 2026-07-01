# Pinning scripts

Whitelisting a command like `node query.mjs` or `./deploy.sh` trusts the script's **path**, not its **contents**. Once you've audited the script and written the allow rule, that rule keeps approving the path even after the file is rewritten — by a dependency, by the agent under an "allow project edits" policy, by anything. This actually *widens* the blast radius of ordinary edit-allow policies: editing a script is cheap-and-allowed, and then running the edited script is allowed too.

`pinnedScripts()` closes the gap. Record a script's SHA-256 when you audit it; toolgate re-verifies it on every run. Any drift is denied with a re-audit hint.

```ts
import { definePolicy, pinnedScripts } from "@brycehanscomb/toolgate";

export default definePolicy([
  pinnedScripts({
    "query.mjs": "7ef35f032598dd6024ee2da515d9361880d79b81f432694f6d233aab6e2b1c69",
    "db.mjs": "…",
  }),
  // …your existing allow policies, unchanged…
]);
```

Record or update a pin with `toolgate hash`:

```bash
toolgate hash query.mjs db.mjs
# 7ef35f03…  query.mjs
# a1b2c3d4…  db.mjs
```

Pin keys are resolved relative to the project root (absolute paths also work). The expected hash may optionally carry a `sha256:` prefix.

## How it composes

`pinnedScripts()` returns a `deny` policy, and the engine always runs deny policies before allow policies. So it slots in as one extra entry and gates your existing allow rules *without modifying them* — matching scripts still auto-approve; a drifted (or missing) script is blocked first.

It only fires on scripts that are actually **executed** — an interpreter's first positional argument (e.g. `node <script>`) or a directly-run `./script`. A script merely referenced as data — `cat query.mjs`, `grep foo query.mjs` — is never affected.

## Building blocks

The primitives behind `pinnedScripts()` are exported directly:

- `hashFile(absPath)` — returns a file's SHA-256, or `null` if unreadable.
- `fileMatchesHash(absPath, expected)` — compares a file against a recorded pin.
- `executedScriptArg(...)` — extracts the executed-script argument from a command.
