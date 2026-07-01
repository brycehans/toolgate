import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const GH_COMMANDS = new Set(["issue", "pr"]);

const denyGhIssuePrDelete: Policy = {
  name: "Deny gh issue/pr delete",
  description: "Blocks `gh issue delete` and `gh pr delete`",
  action: "deny",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] !== "gh") return;

    const command = tokens[1];
    if (!GH_COMMANDS.has(command)) return;

    if (tokens[2] === "delete") return `gh ${command} delete is not allowed`;
  },
};
export default denyGhIssuePrDelete;
