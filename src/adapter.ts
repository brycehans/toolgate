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
    // An empty reason string is treated as a reasonless deny, so the
    // reason field is consistently undefined when there's no message.
    if (typeof result === "string" && result.length > 0) {
      return deny(result);
    }
    return deny();
  };
}
