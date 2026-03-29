import denyGitAddAndCommit from "./deny-git-add-and-commit";
import denyWritesOutsideProject from "./deny-writes-outside-project";
import denyGitDashC from "./deny-git-dash-c";
import denyBashGrep from "./deny-bash-grep";
import denyCdChained from "./deny-cd-chained";
import denyGitChained from "./deny-git-chained";
import redirectPlansToProject from "./redirect-plans-to-project";
import allowBunTest from "./allow-bun-test";
import allowGitAdd from "./allow-git-add";
import allowGitDiff from "./allow-git-diff";
import allowGitLog from "./allow-git-log";
import allowGitStatus from "./allow-git-status";
import allowGrepInProject from "./allow-grep-in-project";
import allowLsInProject from "./allow-ls-in-project";
import allowExploreInProject from "./allow-explore-in-project";
import allowReadInProject from "./allow-read-in-project";
import allowSearchInProject from "./allow-search-in-project";
import allowFindInProject from "./allow-find-in-project";
import allowPlanInProject from "./allow-plan-in-project";
import allowWebFetchClaude from "./allow-webfetch-claude";
import allowTaskCrud from "./allow-task-crud";
import allowGhReadOnly from "./allow-gh-read-only";
import allowBashFindInProject from "./allow-bash-find-in-project";
import allowSuperpowersSkills from "./allow-superpowers-skills";
import allowGitRevParse from "./allow-git-rev-parse";
import allowCdInProject from "./allow-cd-in-project";
import allowGitWorktree from "./allow-git-worktree";
import allowReadOnlyGitBranch from "./allow-git-branch";
import allowGitCheckoutB from "./allow-git-checkout-b";
import allowSafeReadCommands from "./allow-safe-read-commands";
import allowPureAndChains from "./allow-pure-and-chains";
import allowReadPluginCache from "./allow-read-plugin-cache";
import allowEditInProject from "./allow-edit-in-project";
import allowWebSearch from "./allow-web-search";
import allowWebFetch from "./allow-web-fetch";
import allowMcpContext7 from "./allow-mcp-context7";
import allowMcpIdeDiagnostics from "./allow-mcp-ide-diagnostics";
import allowPlanMode from "./allow-plan-mode";
import allowMkdirInProject from "./allow-mkdir-in-project";
import allowAskUser from "./allow-ask-user";

export const builtinPolicies = [
  denyGitAddAndCommit,
  redirectPlansToProject,
  denyWritesOutsideProject,
  denyGitDashC,
  denyBashGrep,
  denyCdChained,
  denyGitChained,
  allowBunTest,
  allowGitAdd,
  allowGitDiff,
  allowGitLog,
  allowGitStatus,
  allowGrepInProject,
  allowLsInProject,
  allowExploreInProject,
  allowReadInProject,
  allowSearchInProject,
  allowFindInProject,
  allowPlanInProject,
  allowWebFetchClaude,
  allowTaskCrud,
  allowGhReadOnly,
  allowBashFindInProject,
  allowSuperpowersSkills,
  allowGitRevParse,
  allowCdInProject,
  allowGitWorktree,
  allowReadOnlyGitBranch,
  allowGitCheckoutB,
  allowSafeReadCommands,
  allowPureAndChains,
  allowReadPluginCache,
  allowEditInProject,
  allowWebSearch,
  allowWebFetch,
  allowMcpContext7,
  allowMcpIdeDiagnostics,
  allowMkdirInProject,
  allowPlanMode,
  allowAskUser,
];
