import denyGitAddAndCommit from "./deny-git-add-and-commit";
import denyWritesOutsideProject from "./deny-writes-outside-project";
import denyGitDashC from "./deny-git-dash-c";
import denyBashGrep from "./deny-bash-grep";
import denyCdChained from "./deny-cd-chained";
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
import allowSafeReadCommands from "./allow-safe-read-commands";

export const builtinPolicies = [
  denyGitAddAndCommit,
  redirectPlansToProject,
  denyWritesOutsideProject,
  denyGitDashC,
  denyBashGrep,
  denyCdChained,
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
  allowSafeReadCommands,
];
