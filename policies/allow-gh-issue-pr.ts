import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const ALLOWED_COMMANDS = new Set(["issue", "pr"]);

const allowGhIssuePr: Policy = {
  name: "Allow gh issue/pr actions",
  description:
    "Permits gh issue and pr subcommands (create, edit, comment, close, reopen, etc.); delete is blocked by the 'Deny gh issue/pr delete' policy",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] !== "gh") return;

    const command = tokens[1];
    if (!ALLOWED_COMMANDS.has(command)) return;

    // Let delete fall through — the deny policy (which runs first) blocks it.
    if (tokens[2] === "delete") return;

    return true;
  },
};
export default allowGhIssuePr;
