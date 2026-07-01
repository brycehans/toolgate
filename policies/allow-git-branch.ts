import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

/** Flags that only read/list branches — no mutations. */
const readonlyFlags = new Set([
  "--show-current",
  "--list",
  "-l",
  "-a",
  "--all",
  "-r",
  "--remotes",
  "-v",
  "-vv",
  "--verbose",
  "--merged",
  "--no-merged",
  "--contains",
  "--no-contains",
  "--sort",
  "--format",
  "--color",
  "--no-color",
  "--column",
  "--no-column",
  "--abbrev",
  "--no-abbrev",
  "--points-at",
]);

/** Flags that take a value as the next token. */
const flagsWithValue = new Set([
  "--contains",
  "--no-contains",
  "--sort",
  "--format",
  "--abbrev",
  "--points-at",
  "--merged",
  "--no-merged",
  "--color",
]);

/** Flags that mutate branches — must be rejected. */
const mutationFlags = new Set([
  "-d",
  "-D",
  "--delete",
  "-m",
  "-M",
  "--move",
  "-c",
  "-C",
  "--copy",
  "--edit-description",
  "--set-upstream-to",
  "-u",
  "--unset-upstream",
  "--track",
  "-t",
  "--no-track",
  "-f",
  "--force",
]);

const allowReadOnlyGitBranch: Policy = {
  name: "Allow git branch (read-only)",
  description:
    "Permits read-only git branch commands (list, show-current, filtering) while blocking branch creation/deletion/rename",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] !== "git" || tokens[1] !== "branch") return;

    const args = tokens.slice(2);

    // Bare `git branch` (lists local branches) is safe
    if (args.length === 0) return true;

    let hasReadonlyFlag = false;
    let i = 0;
    while (i < args.length) {
      const arg = args[i];

      // Handle --flag=value style
      const flagName = arg.includes("=") ? arg.split("=")[0] : arg;

      if (mutationFlags.has(flagName)) return;

      if (readonlyFlags.has(flagName)) {
        hasReadonlyFlag = true;
        // Skip the next token if this flag takes a value and wasn't --flag=value
        if (flagsWithValue.has(flagName) && !arg.includes("=")) {
          i += 2;
          continue;
        }
        i++;
        continue;
      }

      // Positional arg (branch name) without a readonly flag means creation
      if (!arg.startsWith("-")) {
        // Only safe if we already saw a flag that takes a branch pattern
        // (like --contains <commit>, --merged <commit>) — those are handled above.
        // A bare positional means `git branch <name>` = create branch.
        return;
      }

      // Unknown flag — don't allow
      return;
    }

    if (hasReadonlyFlag || args.length === 0) return true;
    return;
  },
};
export default allowReadOnlyGitBranch;
