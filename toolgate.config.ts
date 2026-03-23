import { definePolicy } from "./src/index";

import allowBunTest from "./toolgate/policies/allow-bun-test";
import allowExactCommands from "./toolgate/policies/allow-exact-commands";
import allowGitAdd from "./toolgate/policies/allow-git-add";
import allowExploreInProject from "./toolgate/policies/allow-explore-in-project";
import allowReadInProject from "./toolgate/policies/allow-read-in-project";

export default definePolicy([
  allowExactCommands,
  allowBunTest,
  allowGitAdd,
  allowExploreInProject,
  allowReadInProject,
]);
