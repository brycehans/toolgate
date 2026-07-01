import type { Policy } from "../src";
import { safeBashCommandOrPipeline } from "./parse-bash-ast";

export interface AwsCliPolicyConfig {
  /** Profile patterns that auto-allow non-destructive commands (case-insensitive regex) */
  readOnlyProfiles?: RegExp[];
  /** Profile patterns that always require approval (case-insensitive regex) */
  adminProfiles?: RegExp[];
  /** Account IDs that always require approval */
  restrictedAccountIds?: string[];
  /** Extra destructive subcommands beyond the built-in set */
  extraDestructiveSubcommands?: string[];
}

/**
 * Destructive AWS subcommands that should never be auto-executed.
 * Matches the second token after the service name (e.g. `aws s3 rm`).
 */
const DEFAULT_DESTRUCTIVE_SUBCOMMANDS = new Set([
  "delete-bucket",
  "delete-stack",
  "delete-table",
  "delete-cluster",
  "delete-db-instance",
  "delete-db-cluster",
  "delete-function",
  "delete-rest-api",
  "delete-distribution",
  "delete-queue",
  "delete-topic",
  "delete-repository",
  "delete-secret",
  "delete-log-group",
  "delete-alarm",
  "delete-role",
  "delete-user",
  "delete-policy",
  "delete-group",
  "delete-vpc",
  "delete-subnet",
  "delete-security-group",
  "delete-key-pair",
  "delete-snapshot",
  "delete-volume",
  "delete-image",
  "terminate-instances",
  "deregister-task-definition",
  "delete-service",
  "purge-queue",
  "empty-bucket",
]);

/** s3 high-level subcommands that are destructive */
const DESTRUCTIVE_S3_COMMANDS = new Set(["rm", "rb"]);

const DEFAULT_READ_ONLY_PROFILES = [/ReadOnly|Auditor/i];
const DEFAULT_ADMIN_PROFILES = [/Admin|AdministratorAccess/i];

function extractProfile(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "--profile" && i + 1 < tokens.length) {
      return tokens[i + 1];
    }
    if (tokens[i].startsWith("--profile=")) {
      return tokens[i].slice("--profile=".length);
    }
  }
  return null;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

function isDestructiveCommand(tokens: string[], extra: Set<string>): boolean {
  // Find the service index (first non-flag token after "aws")
  let serviceIdx = -1;
  for (let i = 1; i < tokens.length; i++) {
    if (!tokens[i].startsWith("-")) {
      serviceIdx = i;
      break;
    }
  }
  if (serviceIdx === -1) return false;

  const service = tokens[serviceIdx];
  const subcommand = tokens[serviceIdx + 1];
  if (!subcommand) return false;

  // s3 high-level destructive commands
  if (service === "s3" && DESTRUCTIVE_S3_COMMANDS.has(subcommand)) return true;

  // General destructive subcommands (service-level API calls)
  if (DEFAULT_DESTRUCTIVE_SUBCOMMANDS.has(subcommand) || extra.has(subcommand)) return true;

  // Catch any remaining delete-* or remove-* or terminate-* patterns
  if (/^(delete|remove|terminate|destroy|purge)-/.test(subcommand)) return true;

  return false;
}

function mentionsRestrictedAccount(tokens: string[], accountIds: string[]): boolean {
  return accountIds.length > 0 && tokens.some((t) => accountIds.some((id) => t.includes(id)));
}


/**
 * Create an AWS CLI policy with custom configuration.
 *
 * Usage in toolgate.config.ts:
 * ```ts
 * import { createAwsCliPolicy } from "toolgate/policies/allow-aws-cli";
 * export default [
 *   createAwsCliPolicy({
 *     readOnlyProfiles: [/ReadOnly/i, /Auditor/i],
 *     adminProfiles: [/Admin/i, /PowerUser/i],
 *     restrictedAccountIds: ["123456789012", "987654321098"],
 *   }),
 * ];
 * ```
 */
export function createAwsCliPolicy(config: AwsCliPolicyConfig = {}): Policy {
  const readOnlyPatterns = config.readOnlyProfiles ?? DEFAULT_READ_ONLY_PROFILES;
  const adminPatterns = config.adminProfiles ?? DEFAULT_ADMIN_PROFILES;
  const restrictedIds = config.restrictedAccountIds ?? [];
  const extraDestructive = new Set(config.extraDestructiveSubcommands ?? []);

  return {
    name: "Allow AWS CLI",
    description:
      "Auto-allows non-destructive AWS CLI commands with ReadOnly profiles; requires approval for Admin profiles; denies destructive commands",
  action: "allow",
    handler: async (call) => {
      const tokens = await safeBashCommandOrPipeline(call);
      if (!tokens || tokens[0] !== "aws") return;

      const profile = extractProfile(tokens);

      // Destructive commands — always require approval
      if (isDestructiveCommand(tokens, extraDestructive)) return;

      // Restricted account ID mentioned — require approval
      if (mentionsRestrictedAccount(tokens, restrictedIds)) return;

      // ReadOnly profile → auto-allow non-destructive commands
      if (profile && matchesAny(profile, readOnlyPatterns)) return true;

      // Admin profile → always require approval
      if (profile && matchesAny(profile, adminPatterns)) return;

      // No profile or unrecognised profile → fall through to prompt
      return;
    },
  };
}

/** Built-in instance with default configuration */
const allowAwsCli = createAwsCliPolicy();
export default allowAwsCli;
