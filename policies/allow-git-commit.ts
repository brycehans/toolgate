import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const allowGitCommit: Policy = {
  name: "Allow git commit",
  description: "Permits standalone git commit commands (chained add+commit is caught by deny policy)",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return;
    if (tokens[0] === "git" && tokens[1] === "commit") return true;
    return;
  },
};
export default allowGitCommit;
