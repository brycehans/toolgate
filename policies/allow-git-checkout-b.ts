import { allow, next, type Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const allowGitCheckoutB: Policy = {
  name: "Allow git checkout -b",
  description:
    "Permits git checkout -b <branch> to create and switch to a new branch",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return next();
    if (tokens[0] !== "git" || tokens[1] !== "checkout") return next();

    const args = tokens.slice(2);

    // git checkout -b <branch> or git checkout -b <branch> <start-point>
    if (args.length < 2 || args.length > 3) return next();
    if (args[0] !== "-b") return next();

    // Branch name must not start with a dash
    if (args[1].startsWith("-")) return next();

    // Optional start-point must not start with a dash
    if (args.length === 3 && args[2].startsWith("-")) return next();

    return allow();
  },
};
export default allowGitCheckoutB;
