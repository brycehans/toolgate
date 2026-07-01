import type { ToolCall, VerdictResult, PolicyHandler } from "./types";
import { allow, deny, next } from "./verdicts";

export function adaptHandler(
  action: "deny" | "allow",
  handler: PolicyHandler,
): (call: ToolCall) => Promise<VerdictResult> {
  return async (call: ToolCall): Promise<VerdictResult> => {
    const result = await handler(call);

    // Falsy or void → pass through
    if (result === undefined || result === null || result === false) {
      return next();
    }

    if (action === "allow") {
      return allow();
    }

    // action === "deny"
    if (typeof result === "string") {
      return deny(result);
    }
    return deny();
  };
}
