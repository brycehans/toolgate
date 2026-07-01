import type { Policy } from "../src";

/**
 * Allow WebFetch requests to *.claude.com URLs.
 */
const allowWebFetchClaude: Policy = {
  name: "Allow WebFetch claude.com",
  description: "Permits WebFetch requests to claude.com and subdomains",
  action: "allow",
  handler: async (call) => {
    if (call.tool !== "WebFetch") {
      return;
    }

    const url = call.args.url;
    if (typeof url !== "string") {
      return;
    }

    try {
      const parsed = new URL(url);
      if (parsed.hostname === "claude.com" || parsed.hostname.endsWith(".claude.com")) {
        return true;
      }
    } catch {
      // invalid URL, pass through
    }

    return;
  },
};
export default allowWebFetchClaude;
