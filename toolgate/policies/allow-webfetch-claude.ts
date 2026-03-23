import { allow, next, type Policy } from "../../src";

/**
 * Allow WebFetch requests to *.claude.com URLs.
 */
const allowWebFetchClaude: Policy = {
  name: "Allow WebFetch claude.com",
  description: "Permits WebFetch requests to claude.com and subdomains",
  handler: async (call) => {
    if (call.tool !== "WebFetch") {
      return next();
    }

    const url = call.args.url;
    if (typeof url !== "string") {
      return next();
    }

    try {
      const parsed = new URL(url);
      if (parsed.hostname === "claude.com" || parsed.hostname.endsWith(".claude.com")) {
        return allow();
      }
    } catch {
      // invalid URL, pass through
    }

    return next();
  },
};
export default allowWebFetchClaude;
