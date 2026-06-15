import denyGitAddAndCommit from "./deny-git-add-and-commit";
import denyWritesOutsideProject from "./deny-writes-outside-project";
import denyGitDashC from "./deny-git-dash-c";
import allowBashGrepInProject from "./allow-bash-grep-in-project";
import denyCdChained from "./deny-cd-chained";
import denyGitChained from "./deny-git-chained";
import denyGhHeredoc from "./deny-gh-heredoc";
import denySshCompound from "./deny-ssh-compound";
import denyMixedPureChains from "./deny-mixed-pure-chains";
import denyPerlOneLiners from "./deny-perl-one-liners";
import denyWranglerPipes from "./deny-wrangler-pipes";
import redirectTrivialWranglerToRead from "./redirect-trivial-wrangler-to-read";
import redirectPythonJsonToFx from "./redirect-python-json-to-fx";
import redirectPlansToProject from "./redirect-plans-to-project";
import allowBunTest from "./allow-bun-test";
import allowGitAdd from "./allow-git-add";
import allowGitDiff from "./allow-git-diff";
import allowGitLog from "./allow-git-log";
import allowGitStatus from "./allow-git-status";
import allowGrepInProject from "./allow-grep-in-project";
import allowLs from "./allow-ls";
import allowAgent from "./allow-agent";
import allowExploreInProject from "./allow-explore-in-project";
import allowReadInProject from "./allow-read-in-project";
import allowSearchInProject from "./allow-search-in-project";
import allowFindInProject from "./allow-find-in-project";
import allowPlanInProject from "./allow-plan-in-project";
import allowWebFetchClaude from "./allow-webfetch-claude";
import allowTaskCrud from "./allow-task-crud";
import allowGhReadOnly from "./allow-gh-read-only";
import allowBashFind from "./allow-bash-find";
import allowSuperpowersSkills from "./allow-superpowers-skills";
import allowGitCheckIgnore from "./allow-git-check-ignore";
import allowGitRevParse from "./allow-git-rev-parse";
import allowGitStash from "./allow-git-stash";
import allowCdInProject from "./allow-cd-in-project";
import allowGitWorktree from "./allow-git-worktree";
import allowReadOnlyGitBranch from "./allow-git-branch";
import allowGitCheckoutB from "./allow-git-checkout-b";
import allowGitCommit from "./allow-git-commit";
import allowSafeReadCommands from "./allow-safe-read-commands";
import allowPureAndChains from "./allow-pure-and-chains";
import allowReadPluginCache from "./allow-read-plugin-cache";
import allowReadToolResults from "./allow-read-tool-results";
import allowEditInProject from "./allow-edit-in-project";
import allowWebSearch from "./allow-web-search";
import allowWebFetch from "./allow-web-fetch";
import allowMcpContext7 from "./allow-mcp-context7";
import allowMcpIdeDiagnostics from "./allow-mcp-ide-diagnostics";
import allowMcpPlaywright from "./allow-mcp-playwright";
import allowPlanMode from "./allow-plan-mode";
import allowMkdirInProject from "./allow-mkdir-in-project";
import allowAskUser from "./allow-ask-user";
import allowToolSearch from "./allow-tool-search";
import allowGitLocalRepo from "./allow-git-local-repo";
import allowCronCrud from "./allow-cron-crud";
import allowRmProjectTmp from "./allow-rm-project-tmp";
import allowNpmInstall from "./allow-npm-install";
import allowNpxSafe from "./allow-npx-safe";
import allowSleep from "./allow-sleep";
import allowDate from "./allow-date";
import allowNonDestructiveGit from "./allow-non-destructive-git";
import allowGhIssuePr from "./allow-gh-issue-pr";
import allowTmux from "./allow-tmux";
import allowAwsCli from "./allow-aws-cli";
import allowBrew from "./allow-brew";
import allowToolgateTest from "./allow-toolgate-test";
import allowMemoryCrud from "./allow-memory-crud";

export const builtinPolicies = [
  denyGitAddAndCommit,
  redirectPlansToProject,
  redirectPythonJsonToFx,
  denyWritesOutsideProject,
  denyGitDashC,
  denyCdChained,
  denyGitChained,
  denyGhHeredoc,
  denySshCompound,
  denyMixedPureChains,
  denyPerlOneLiners,
  denyWranglerPipes,
  redirectTrivialWranglerToRead,
  allowBunTest,
  allowGitAdd,
  allowGitDiff,
  allowGitLog,
  allowGitStatus,
  allowGrepInProject,
  allowLs,
  allowAgent,
  allowExploreInProject,
  allowReadInProject,
  allowSearchInProject,
  allowFindInProject,
  allowPlanInProject,
  allowWebFetchClaude,
  allowTaskCrud,
  allowGhReadOnly,
  allowGhIssuePr,
  allowBashFind,
  allowBashGrepInProject,
  allowSuperpowersSkills,
  allowGitCheckIgnore,
  allowGitRevParse,
  allowCdInProject,
  allowGitWorktree,
  allowReadOnlyGitBranch,
  allowGitCheckoutB,
  allowGitCommit,
  allowGitStash,
  allowGitLocalRepo,
  allowSafeReadCommands,
  allowPureAndChains,
  allowReadPluginCache,
  allowReadToolResults,
  allowEditInProject,
  allowWebSearch,
  allowWebFetch,
  allowMcpContext7,
  allowMcpIdeDiagnostics,
  allowMcpPlaywright,
  allowMkdirInProject,
  allowPlanMode,
  allowAskUser,
  allowToolSearch,
  allowCronCrud,
  allowRmProjectTmp,
  allowNpmInstall,
  allowNpxSafe,
  allowSleep,
  allowDate,
  allowNonDestructiveGit,
  allowTmux,
  allowAwsCli,
  allowBrew,
  allowToolgateTest,
  allowMemoryCrud,
];
