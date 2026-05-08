import { allow, next, type Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

const allowLsof: Policy = {
  name: "Allow lsof",
  description: "Permits lsof for inspecting open files, sockets, and ports, optionally piped through safe filters",
  handler: async (call) => {
    const tokens = await safeBashCommandOrPipeline(call);
    if (!tokens || tokens[0] !== "lsof") return next();
    return allow();
  },
};
export default allowLsof;
