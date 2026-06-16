import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const VERSION_FLAGS = new Set(["--version", "-version", "--help"]);

const allowVersionProbes: Policy = {
  name: "Allow version probes",
  description:
    "Permits `<cmd> --version` / `<cmd> -version` / `<cmd> --help` invocations (optionally piped through safe filters); rejects any additional positional args",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens.length !== 2) return;
    if (!VERSION_FLAGS.has(tokens[1])) return;
    return true;
  },
};
export default allowVersionProbes;
