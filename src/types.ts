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
}

export type VerdictResult =
  | { verdict: typeof ALLOW }
  | { verdict: typeof DENY; reason?: string }
  | { verdict: typeof NEXT };

export type Middleware = (call: ToolCall) => Promise<VerdictResult>;

export interface Policy {
  name: string;
  description: string;
  handler: Middleware;
}
