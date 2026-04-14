import { describe, expect, it } from "bun:test";
import { ALLOW, DENY, NEXT, type ToolCall } from "toolgate";
import allowAwsCli, { createAwsCliPolicy } from "../allow-aws-cli";

const PROJECT = "/home/user/project";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
  };
}

describe("allow-aws-cli", () => {
  describe("auto-allows ReadOnly profile non-destructive commands", () => {
    const allowed = [
      "aws s3 ls --profile ko-ReadOnly",
      "aws s3 ls s3://my-bucket --profile=ko-ReadOnly",
      "aws ec2 describe-instances --profile ko-ReadOnly",
      "aws sts get-caller-identity --profile ko-ReadOnly",
      "aws cloudformation describe-stacks --profile ko-ReadOnly",
      "aws iam list-roles --profile ko-ReadOnly",
      "aws lambda list-functions --profile ko-ReadOnly",
      "aws logs describe-log-groups --profile ko-ReadOnly",
      "aws s3 cp s3://bucket/key - --profile ko-ReadOnly",
      "aws ec2 describe-vpcs --profile ko-ReadOnly | head -20",
      "aws s3 ls --profile ko-Auditor",
      "aws ec2 describe-instances --profile ko-Auditor",
      "aws sts get-caller-identity --profile=ko-Auditor",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowAwsCli.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("denies destructive commands regardless of profile", () => {
    const denied = [
      "aws s3 rm s3://my-bucket/key --profile ko-ReadOnly",
      "aws s3 rb s3://my-bucket --profile ko-ReadOnly",
      "aws s3 rm s3://bucket/prefix --recursive --profile ko-Admin",
      "aws cloudformation delete-stack --stack-name my-stack --profile ko-Admin",
      "aws ec2 terminate-instances --instance-ids i-123 --profile ko-ReadOnly",
      "aws dynamodb delete-table --table-name my-table",
      "aws lambda delete-function --function-name my-func --profile ko-AdministratorAccess",
      "aws sqs purge-queue --queue-url https://sqs.example --profile ko-ReadOnly",
      "aws s3api delete-bucket --bucket my-bucket --profile ko-Admin",
      "aws rds delete-db-instance --db-instance-identifier mydb",
      "aws iam delete-role --role-name my-role --profile ko-Admin",
      "aws ec2 delete-vpc --vpc-id vpc-123",
      "aws ecr delete-repository --repository-name my-repo",
      "aws secretsmanager delete-secret --secret-id my-secret",
      "aws logs delete-log-group --log-group-name my-group",
      "aws s3api empty-bucket --bucket my-bucket",
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd}`, async () => {
        const result = await allowAwsCli.handler(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });

  describe("warns and requires approval for Admin profiles (non-destructive)", () => {
    const requireApproval = [
      "aws s3 ls --profile ko-Admin",
      "aws s3 cp file.txt s3://bucket/key --profile ko-Admin",
      "aws ec2 describe-instances --profile ko-AdministratorAccess",
      "aws cloudformation create-stack --stack-name test --template-body file://t.json --profile ko-Admin",
      "aws iam list-roles --profile ko-AdministratorAccess",
      "aws lambda invoke --function-name my-func out.json --profile ko-Admin",
    ];

    for (const cmd of requireApproval) {
      it(`warns: ${cmd}`, async () => {
        const result = await allowAwsCli.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
        expect("reason" in result && result.reason).toContain("⚠️");
        expect("reason" in result && result.reason).toContain("admin profile");
      });
    }
  });

  describe("falls through for no profile or unknown profile", () => {
    const fallThrough = [
      "aws s3 ls",
      "aws ec2 describe-instances --region us-east-1",
      "aws s3 ls --profile ko-Developer",
    ];

    for (const cmd of fallThrough) {
      it(`falls through: ${cmd}`, async () => {
        const result = await allowAwsCli.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
        // No warning reason for unknown profiles — just a plain next()
        expect("reason" in result).toBe(false);
      });
    }
  });

  describe("passes through non-aws commands", () => {
    it("ignores non-Bash tools", async () => {
      const call: ToolCall = {
        tool: "Read",
        args: { file_path: "/foo" },
        context: { cwd: PROJECT, env: {}, projectRoot: PROJECT },
      };
      const result = await allowAwsCli.handler(call);
      expect(result.verdict).toBe(NEXT);
    });

    it("ignores non-aws bash commands", async () => {
      const result = await allowAwsCli.handler(bash("git status"));
      expect(result.verdict).toBe(NEXT);
    });

    it("ignores compound commands", async () => {
      const result = await allowAwsCli.handler(bash("aws s3 ls && aws s3 rm s3://bucket/key"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("case-insensitive profile matching", () => {
    it("matches readonly case-insensitively", async () => {
      const result = await allowAwsCli.handler(bash("aws s3 ls --profile ko-readonly"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("matches admin case-insensitively", async () => {
      const result = await allowAwsCli.handler(bash("aws s3 ls --profile ko-admin"));
      expect(result.verdict).toBe(NEXT);
      expect("reason" in result && result.reason).toContain("⚠️");
    });
  });

  describe("catches generic destructive patterns", () => {
    const denied = [
      "aws some-service remove-thing --id 123 --profile ko-ReadOnly",
      "aws some-service destroy-resource --name foo",
    ];

    for (const cmd of denied) {
      it(`denies: ${cmd}`, async () => {
        const result = await allowAwsCli.handler(bash(cmd));
        expect(result.verdict).toBe(DENY);
      });
    }
  });
});

describe("createAwsCliPolicy (custom config)", () => {
  const custom = createAwsCliPolicy({
    readOnlyProfiles: [/SecurityAudit/i, /ViewOnly/i],
    adminProfiles: [/PowerUser/i, /FullAccess/i],
    restrictedAccountIds: ["111111111111", "222222222222"],
    extraDestructiveSubcommands: ["stop-instances", "reboot-instances"],
  });

  describe("uses custom readOnly profiles", () => {
    it("allows SecurityAudit profile", async () => {
      const result = await custom.handler(bash("aws s3 ls --profile ko-SecurityAudit"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("allows ViewOnly profile", async () => {
      const result = await custom.handler(bash("aws ec2 describe-instances --profile ViewOnly"));
      expect(result.verdict).toBe(ALLOW);
    });

    it("does NOT auto-allow default ReadOnly when overridden", async () => {
      const result = await custom.handler(bash("aws s3 ls --profile ko-ReadOnly"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("uses custom admin profiles", () => {
    it("warns for PowerUser", async () => {
      const result = await custom.handler(bash("aws s3 ls --profile ko-PowerUser"));
      expect(result.verdict).toBe(NEXT);
      expect("reason" in result && result.reason).toContain("⚠️");
    });

    it("warns for FullAccess", async () => {
      const result = await custom.handler(bash("aws s3 ls --profile staging-FullAccess"));
      expect(result.verdict).toBe(NEXT);
      expect("reason" in result && result.reason).toContain("⚠️");
    });

    it("does NOT flag default Admin when overridden", async () => {
      const result = await custom.handler(bash("aws s3 ls --profile ko-Admin"));
      expect(result.verdict).toBe(NEXT);
      // No warning — falls through as unknown profile
      expect("reason" in result).toBe(false);
    });
  });

  describe("warns for restricted account IDs", () => {
    it("warns for custom account ID", async () => {
      const result = await custom.handler(
        bash("aws sts assume-role --role-arn arn:aws:iam::111111111111:role/Role --profile ko-SecurityAudit"),
      );
      expect(result.verdict).toBe(NEXT);
      expect("reason" in result && result.reason).toContain("⚠️");
      expect("reason" in result && result.reason).toContain("restricted account");
    });

    it("does not warn when no restricted account is mentioned", async () => {
      const result = await custom.handler(
        bash("aws s3 ls --profile ko-SecurityAudit"),
      );
      expect(result.verdict).toBe(ALLOW);
    });
  });

  describe("uses extra destructive subcommands", () => {
    it("denies stop-instances", async () => {
      const result = await custom.handler(
        bash("aws ec2 stop-instances --instance-ids i-123 --profile ko-SecurityAudit"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("denies reboot-instances", async () => {
      const result = await custom.handler(
        bash("aws ec2 reboot-instances --instance-ids i-123"),
      );
      expect(result.verdict).toBe(DENY);
    });

    it("still denies built-in destructive commands", async () => {
      const result = await custom.handler(
        bash("aws s3 rm s3://bucket/key --profile ko-SecurityAudit"),
      );
      expect(result.verdict).toBe(DENY);
    });
  });
});
