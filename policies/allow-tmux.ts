import { ALLOW, runPolicy, type Policy, type ToolCall } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

/**
 * Tmux subcommands that only read state — never modify sessions/windows/panes.
 */
const READ_ONLY_TMUX = new Set([
  "capture-pane",
  "display-message",
  "list-buffers",
  "list-clients",
  "list-commands",
  "list-keys",
  "list-panes",
  "list-sessions",
  "list-windows",
  "show-buffer",
  "show-environment",
  "show-messages",
  "show-options",
  "show-window-options",
  "display-panes",
  "has-session",
  "info",
  "server-info",
  "show-hooks",
]);

/** Keys that trigger execution but aren't part of the command text. */
const TERMINAL_KEYS = new Set(["Enter", "C-m", "C-c", "C-d", ""]);

const allowTmux: Policy = {
  name: "Allow tmux read and send-keys",
  description:
    "Auto-allows read-only tmux commands; for send-keys, extracts the inner command and allows only if the policy chain would allow it",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return;
    if (tokens[0] !== "tmux") return;

    const sub = tokens[1];
    if (!sub) return;

    // Read-only tmux subcommands → allow
    if (READ_ONLY_TMUX.has(sub)) return true;

    // send-keys → extract inner command, evaluate through policies
    if (sub !== "send-keys") return;

    const rest = tokens.slice(2);
    const commandParts: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "-t" && i + 1 < rest.length) {
        i++; // skip target pane
        continue;
      }
      if (rest[i] === "-l") continue; // literal flag
      if (TERMINAL_KEYS.has(rest[i])) continue;
      commandParts.push(rest[i]);
    }

    const innerCommand = commandParts.join(" ");
    if (!innerCommand) return true; // just sending Enter/C-c/etc.

    // Create synthetic Bash call and run through the policy chain.
    // As an allow-only policy we can just green-light the safe cases; if the
    // chain wouldn't allow the inner command, fall through so it's prompted
    // (a would-be inner deny becomes an ask, which is still safe).
    const { builtinPolicies } = await import("./index");
    const otherPolicies = builtinPolicies.filter((p: Policy) => p !== allowTmux);

    const syntheticCall: ToolCall = {
      tool: "Bash",
      args: { command: innerCommand },
      context: call.context,
    };

    const result = await runPolicy(otherPolicies, syntheticCall);
    if (result.verdict === ALLOW) return true;
    return;
  },
};
export default allowTmux;
