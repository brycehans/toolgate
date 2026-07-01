import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowLsof: Policy = {
  name: "Allow lsof",
  description: "Permits lsof for inspecting open files, sockets, and processes; optionally piped through safe filters",
  action: "allow",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens) return;
    if (tokens[0] !== "lsof") return;
    return true;
  },
};
export default allowLsof;
