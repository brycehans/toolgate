import type { ALLOW, DENY, NEXT } from "./verdicts";

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
  context: CallContext;
}

export interface CallContext {
  cwd: string;
  env: Record<string, string>;
  projectRoot: string;
  additionalDirs: string[];
}

export type VerdictResult =
  | { verdict: typeof ALLOW }
  | { verdict: typeof DENY; reason?: string }
  | { verdict: typeof NEXT };

/** @internal Used by the engine to run adapted handlers */
export type Middleware = (call: ToolCall) => Promise<VerdictResult>;

/** New simplified handler signature for policy authors */
export type PolicyHandler = (call: ToolCall) => Promise<string | boolean | void>;

export interface Policy {
  name: string;
  description: string;
  action: "deny" | "allow";
  handler: PolicyHandler;
}
