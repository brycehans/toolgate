import { allow, deny, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const ALLOWED_COMMANDS = new Set(["issue", "pr"]);

const allowGhIssuePr: Policy = {
  name: "Allow gh issue/pr actions",
  description:
    "Permits gh issue and pr subcommands (create, edit, comment, close, reopen, etc.) but denies delete",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return next();
    if (tokens[0] !== "gh") return next();

    const command = tokens[1];
    if (!ALLOWED_COMMANDS.has(command)) return next();

    const subcommand = tokens[2];
    if (subcommand === "delete") return deny(`gh ${command} delete is not allowed`);

    return allow();
  },
};
export default allowGhIssuePr;
