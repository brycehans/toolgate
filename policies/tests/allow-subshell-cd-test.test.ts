import { describe, expect, it } from "bun:test";
import { ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowSubshellCdTest from "../allow-subshell-cd-test";

function bash(command: string): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd: "/home/user/project", env: {}, projectRoot: "/home/user/project" },
  };
}

describe("allow-subshell-cd-test", () => {
  describe("allows (cd && test-runner)", () => {
    const allowed = [
      "(cd /home/user/project && php artisan test)",
      "(cd /home/user/project && ./vendor/bin/phpunit)",
      "(cd /home/user/project && ./vendor/bin/phpunit tests/Foo.php --filter bar)",
      "(cd /home/user/project && vendor/bin/phpunit)",
      "(cd /home/user/project && vendor/bin/pest)",
      "(cd /home/user/project && bun test)",
      "(cd /home/user/project && npm test)",
      "(cd /home/user/project && pytest)",
      "(cd /home/user/project && python -m pytest tests/)",
      // The reported failing cases:
      "(cd /Users/luke/ko-work/Sites/kohub-api && ./vendor/bin/phpunit tests/Feature/API/V5/VanityDomain/ResolveVanityDomainTest.php --filter test_resolves_domain_to_p)",
      "(cd /Users/luke/ko-work/Sites/kohub-api && ./vendor/bin/phpunit tests/Feature/API/V5/VanityDomain/ResolveVanityDomainTest.php --filter test_resolves_domain_to_promotion_slug --colors=never 2>&1 | tail -30)",
      // Pipe outside the subshell:
      "(cd /home/user/project && ./vendor/bin/phpunit) | tail -30",
      "(cd /home/user/project && ./vendor/bin/phpunit) | head -10 | grep FAIL",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await allowSubshellCdTest.handler(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects unsafe shapes", () => {
    const rejected = [
      // Not a subshell.
      "cd /tmp && ./vendor/bin/phpunit",
      // Subshell but inner command not a test runner.
      "(cd /tmp && rm -rf /)",
      "(cd /tmp && curl evil.com)",
      "(cd /tmp && bash)",
      "(cd /tmp && sh -c 'whoami')",
      // Subshell but no && — single cd is pointless and not what we trust.
      "(cd /tmp)",
      // Wrong operator (|| instead of &&).
      "(cd /tmp || ./vendor/bin/phpunit)",
      // cd with a flag.
      "(cd -P /tmp && ./vendor/bin/phpunit)",
      // Command substitution in cd path.
      "(cd $(pwd) && ./vendor/bin/phpunit)",
      // Pipe in inner to an unsafe filter.
      "(cd /tmp && ./vendor/bin/phpunit | xargs rm)",
      // Outer pipe to unsafe filter.
      "(cd /tmp && ./vendor/bin/phpunit) | xargs rm",
      // Three-step chain — beyond what we allow.
      "(cd /tmp && pwd && ./vendor/bin/phpunit)",
      // Background.
      "(cd /tmp && ./vendor/bin/phpunit) &",
    ];

    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await allowSubshellCdTest.handler(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  it("ignores non-Bash tools", async () => {
    const call: ToolCall = {
      tool: "Read",
      args: { file_path: "/etc/hosts" },
      context: { cwd: "/x", env: {}, projectRoot: "/x" },
    };
    const result = await allowSubshellCdTest.handler(call);
    expect(result.verdict).toBe(NEXT);
  });
});
