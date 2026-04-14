import { allow, next, type Policy, type ToolCall } from "../src";
import { runPolicy } from "../src/policy";
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
    "Auto-allows read-only tmux commands; for send-keys, extracts the inner command and evaluates it through the policy chain",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return next();
    if (tokens[0] !== "tmux") return next();

    const sub = tokens[1];
    if (!sub) return next();

    // Read-only tmux subcommands → allow
    if (READ_ONLY_TMUX.has(sub)) return allow();

    // send-keys → extract inner command, evaluate through policies
    if (sub !== "send-keys") return next();

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
    if (!innerCommand) return allow(); // just sending Enter/C-c/etc.

    // Create synthetic Bash call and run through the policy chain
    const { builtinPolicies } = await import("./index");
    const otherPolicies = builtinPolicies.filter((p: Policy) => p !== allowTmux);

    const syntheticCall: ToolCall = {
      tool: "Bash",
      args: { command: innerCommand },
      context: call.context,
    };

    return runPolicy(otherPolicies, syntheticCall);
  },
};
export default allowTmux;
