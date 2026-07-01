# Amplitude: Impact-Aware Permission Filtering for Toolgate

## Problem

Toolgate's policy engine makes binary per-call decisions (allow/deny/ask), but there's no way to globally shift how permissive the system is. Users want a single dial — "amplitude" — that controls how much latitude Claude gets, framed in human terms (observe / change local / change global) rather than tool categories.

## Core Insight

The MCP protocol already defines a vocabulary for tool impact: `readOnly`, `destructive`, `idempotent`, `openWorld`. Toolgate can compute these annotations per-invocation using domain knowledge (Bash AST parsing, file-path analysis), then use amplitude as a filter over them. This separates three concerns:

1. **Classification** — "what kind of thing is this?" (annotations)
2. **Policy** — "should this be permitted?" (allow/deny/next — unchanged)
3. **Amplitude** — "does the current trust level permit this kind of thing?"

## Data Model

### Annotations

Attached to every tool call after classification:

```ts
interface Annotations {
  readOnly?: boolean;    // doesn't modify state
  destructive?: boolean; // hard to reverse
  openWorld?: boolean;   // visible outside this machine
  idempotent?: boolean;  // safe to repeat
}
```

Unset fields mean "unknown" — treated conservatively (assumed worst-case: not read-only, potentially destructive, open-world, non-idempotent).

### Amplitude Presets

Named constraint sets that define a trust threshold:

| Name      | Constraint                | Plain English                      |
|-----------|---------------------------|------------------------------------|
| `observe` | `readOnly === true`       | Only let through reads             |
| `local`   | `openWorld !== true`      | Anything that stays on my machine  |
| `full`    | *(no constraint)*         | Everything not denied              |

### Interaction with Policy Verdicts

- `deny()` — always final, amplitude cannot override
- `allow()` + annotations pass amplitude filter — allow
- `allow()` + annotations fail amplitude filter — downgrade to `next()` (ask user)
- `next()` — always ask, amplitude cannot upgrade

Amplitude only gates the upside. It never weakens the floor that deny policies establish.

## Architecture

### Pipeline

```
stdin → buildToolCall() → classify(call) → runPolicy(call) → amplitudeFilter(verdict, annotations) → stdout
```

### Classifier Layer

A chain of small functions, each characterizing tool calls it understands:

```ts
type Classifier = (call: ToolCall) => Promise<Partial<Annotations>>;
```

Returns only the fields it has an opinion on. Empty object means "I don't know about this call."

**Merging:** Classifiers run in order. Later classifiers override earlier ones. Fields merge with last-write-wins per field:

```ts
// classifier 1: { readOnly: true }
// classifier 2: { openWorld: true }
// merged:       { readOnly: true, openWorld: true }

// classifier 3: { readOnly: false }  — overrides classifier 1
// final:        { readOnly: false, openWorld: true }
```

**Ordering convention:** General classifiers first (MCP self-declarations, broad tool-type defaults), specific classifiers last (Bash command parsing, file-path analysis). Specific overrides general.

### Built-in Classifiers

1. **MCP defaults** — passes through self-declared annotations from MCP tools as an untrusted baseline
2. **Tool-type defaults** — `Read`/`Glob`/`Grep` → `{ readOnly: true }`, `Edit`/`Write` → `{ readOnly: false, openWorld: false }`
3. **Bash command classifier** — parses the command via shfmt AST, tags `git push` as openWorld, `rm` as destructive, `cat` as readOnly, etc.
4. **File-path classifier** — if the target file is CI config, `.env`, or similar → `{ openWorld: true }` (editing a deploy pipeline has external consequences)

**Unknown tool calls:** If no classifier claims it, all fields stay unset. Unset = worst-case. Unknown tools at `observe` amplitude get downgraded to ask — safe by default.

### Amplitude Filter

The gate between policy verdict and final response:

```ts
function amplitudeFilter(
  verdict: VerdictResult,
  annotations: Annotations,
  amplitude: AmplitudePreset
): VerdictResult {
  if (verdict.verdict === DENY) return verdict;
  if (verdict.verdict === NEXT) return verdict;

  if (passesAmplitude(annotations, amplitude)) return verdict;

  return next(); // downgrade to ask
}
```

```ts
function passesAmplitude(a: Annotations, preset: AmplitudeConstraints): boolean {
  if (preset.readOnly === true && a.readOnly !== true) return false;
  if (preset.openWorld === false && a.openWorld !== false) return false;
  return true;
}
```

### Configuration

Top-level field in `toolgate.config.ts` or CLI flag:

```ts
// toolgate.config.ts
export const amplitude = "local";
```

```bash
# or CLI override
toolgate run --amplitude observe
```

CLI flag overrides config file. Default if unset: `full` (backward compatible).

## What Doesn't Change

- **Policy authoring** — `allow()`, `deny()`, `next()` unchanged. No new fields on `Policy`.
- **Deny policies** — always fire regardless of amplitude.
- **Policy ordering** — first non-`next()` wins.
- **`definePolicy()`** — unchanged.
- **Project configs** — work exactly as before.

## Design Principles

- **Human-shaped levels** — observe/local/full maps to "can anyone else see this?", not tool categories
- **Fail safe** — unknown annotations = worst-case assumption
- **Amplitude only downgrades** — can tighten permissions, never loosen beyond what policies allow
- **Separation of concerns** — classification, policy, and amplitude are independent layers
- **Backward compatible** — amplitude defaults to `full`, existing configs work unchanged

## Future Extensions

- **Custom amplitude presets** — user-defined constraint sets beyond the three built-ins
- **Project-level classifiers** — `toolgate.config.ts` can register additional classifiers
- **Amplitude in hook response** — return annotations alongside the verdict so Claude Code can display impact info
- **Dynamic amplitude** — switch amplitude mid-session (e.g., "go to observe mode while I'm AFK")
