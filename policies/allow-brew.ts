import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

/** Brew subcommands that are purely read-only / informational */
const SAFE_SUBCOMMANDS = new Set([
  "list",
  "ls",
  "info",
  "home",
  "homepage",
  "search",
  "desc",
  "cat",
  "deps",
  "uses",
  "leaves",
  "outdated",
  "config",
  "doctor",
  "log",
  "shellenv",
  "formulae",
  "casks",
  "tap-info",
  "which-formula",
  "which-update",
]);

/** Brew flags that act as read-only subcommands */
const SAFE_FLAGS = new Set([
  "--version",
  "--prefix",
  "--cellar",
  "--caskroom",
  "--cache",
  "--repo",
]);

/** Brew services subcommands that are read-only */
const SAFE_SERVICES_SUBCOMMANDS = new Set(["list", "info"]);

const allowBrew: Policy = {
  name: "Allow brew read-only",
  description:
    "Auto-allows read-only brew commands (list, info, search, etc.); requires approval for install, uninstall, upgrade, and other mutating commands",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens || tokens[0] !== "brew") return next();

    // Check for safe flag-subcommands (e.g. brew --version, brew --prefix)
    if (tokens.length >= 2 && SAFE_FLAGS.has(tokens[1])) return allow();

    // Find the subcommand (first non-flag token after "brew")
    let subcommand: string | undefined;
    for (let i = 1; i < tokens.length; i++) {
      if (!tokens[i].startsWith("-")) {
        subcommand = tokens[i];
        break;
      }
    }
    if (!subcommand) return next();

    // "brew services list" is safe, "brew services start/stop/restart" is not
    if (subcommand === "services") {
      const servicesAction = tokens.find(
        (t, i) => i > tokens.indexOf("services") && !t.startsWith("-"),
      );
      if (servicesAction && SAFE_SERVICES_SUBCOMMANDS.has(servicesAction)) return allow();
      return next();
    }

    if (SAFE_SUBCOMMANDS.has(subcommand)) return allow();

    return next();
  },
};
export default allowBrew;
