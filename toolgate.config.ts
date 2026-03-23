import { definePolicy } from "./src/index";

import denyGitAddAndCommit from "./toolgate/policies/deny-git-add-and-commit";
import denyWritesOutsideProject from "./toolgate/policies/deny-writes-outside-project";
import redirectPlansToProject from "./toolgate/policies/redirect-plans-to-project";
import allowBunTest from "./toolgate/policies/allow-bun-test";
import allowGitAdd from "./toolgate/policies/allow-git-add";
import allowGitDiff from "./toolgate/policies/allow-git-diff";
import allowGitLog from "./toolgate/policies/allow-git-log";
import allowGitStatus from "./toolgate/policies/allow-git-status";
import allowGrepInProject from "./toolgate/policies/allow-grep-in-project";
import allowLsInProject from "./toolgate/policies/allow-ls-in-project";
import allowExploreInProject from "./toolgate/policies/allow-explore-in-project";
import allowReadInProject from "./toolgate/policies/allow-read-in-project";
import allowSearchInProject from "./toolgate/policies/allow-search-in-project";
import allowFindInProject from "./toolgate/policies/allow-find-in-project";
import allowPlanInProject from "./toolgate/policies/allow-plan-in-project";
import allowWebFetchClaude from "./toolgate/policies/allow-webfetch-claude";
import allowTaskCreate from "./toolgate/policies/allow-task-create";

export default definePolicy([
  denyGitAddAndCommit,
  redirectPlansToProject,
  denyWritesOutsideProject,
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
  allowTaskCreate,
]);
