import { allow, next, type Policy } from "../src";
import { safeBashCommand } from "./parse-bash-ast";

const allowSleep: Policy = {
  name: "Allow sleep",
  description: "Permits sleep commands with a numeric duration argument",
  handler: async (call) => {
    const tokens = await safeBashCommand(call);
    if (!tokens) return next();
    if (tokens[0] !== "sleep" || tokens.length !== 2) return next();
    // Only allow numeric durations (e.g. 5, 0.5, 1s, 2m, 3h)
    if (/^\d+(\.\d+)?[smhd]?$/.test(tokens[1])) return allow();
    return next();
  },
};
export default allowSleep;
