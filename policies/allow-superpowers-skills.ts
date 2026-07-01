import type { Policy } from "../src";

function isSuperpowers(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value === "superpowers" || value.startsWith("superpowers:"))
  );
}

const allowSuperpowersSkills: Policy = {
  name: "Allow superpowers skills",
  description:
    "Permits Skill and Agent tool calls for any superpowers:* skill or subagent type",
  action: "allow",
  handler: async (call) => {
    if (call.tool === "Skill" && isSuperpowers(call.args.skill)) {
      return true;
    }

    if (call.tool === "Agent" && isSuperpowers(call.args.subagent_type)) {
      return true;
    }

    return;
  },
};

export default allowSuperpowersSkills;
