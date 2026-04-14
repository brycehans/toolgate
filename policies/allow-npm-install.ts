import { allow, next, type Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const allowNpmInstall: Policy = {
  name: "Allow npm/pnpm/yarn install",
  description: "Permits npm install, pnpm install, and yarn install commands",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return next();

    const cmd = tokens[0];
    const sub = tokens[1];

    if (cmd === "npm" && (sub === "install" || sub === "ci" || sub === "i")) return allow();
    if (cmd === "pnpm" && (sub === "install" || sub === "i")) return allow();
    if (cmd === "yarn" && (sub === "install" || sub === undefined)) return allow();

    return next();
  },
};
export default allowNpmInstall;
