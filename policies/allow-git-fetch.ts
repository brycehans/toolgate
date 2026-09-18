import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

/** Fetch flags that change reporting or prune remote-tracking refs only. */
const SAFE_FLAGS = new Set([
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "--progress",
  "--no-progress",
  "--all",
  "--tags",
  "--no-tags",
  "-p",
  "--prune",
  "--dry-run",
]);

const allowGitFetch: Policy = {
  name: "Allow git fetch",
  description:
    "Permits git fetch into remote-tracking refs, refusing refspecs and unnamed remotes",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] !== "git" || tokens[1] !== "fetch") return;

    for (const arg of tokens.slice(2)) {
      if (arg.startsWith("-")) {
        if (!SAFE_FLAGS.has(arg)) return;
        continue;
      }
      // A `<src>:<dst>` refspec writes straight to a local branch, force-updating
      // it whenever `<dst>` is not the checked-out branch — unpushed commits on it
      // are lost. A ':' also appears in scp-style remote URLs, which this refuses
      // for the same reason as '://': only a configured remote is in scope here.
      if (arg.includes(":") || arg.startsWith("+")) return;
    }

    return true;
  },
};
export default allowGitFetch;
