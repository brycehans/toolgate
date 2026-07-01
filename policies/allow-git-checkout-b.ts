import type { Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const allowGitCheckoutB: Policy = {
  name: "Allow git checkout -b",
  description:
    "Permits git checkout -b <branch> to create and switch to a new branch",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return;
    if (tokens[0] !== "git" || tokens[1] !== "checkout") return;

    const args = tokens.slice(2);

    // git checkout -b <branch> or git checkout -b <branch> <start-point>
    if (args.length < 2 || args.length > 3) return;
    if (args[0] !== "-b") return;

    // Branch name must not start with a dash
    if (args[1].startsWith("-")) return;

    // Optional start-point must not start with a dash
    if (args.length === 3 && args[2].startsWith("-")) return;

    return true;
  },
};
export default allowGitCheckoutB;
