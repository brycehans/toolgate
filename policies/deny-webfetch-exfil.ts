import type { Policy } from "../src";

/**
 * WebFetch is auto-allowed wholesale by `allow-web-fetch`, on the premise that
 * fetching is read-only. But the *request* itself is an outbound channel: a URL
 * can smuggle secrets out in its query string or userinfo, and fetching from a
 * bare public IP is a common C2/exfil shape. This deny runs before the blanket
 * allow and blocks exfiltration-shaped URLs, leaving ordinary fetches untouched.
 */

/** Query-param names that carry credentials/secrets when present in a URL. */
const SECRET_KEY_RE =
  /(^|[_-])(api[_-]?key|access[_-]?key|secret|token|password|passwd|pwd|credentials?|private[_-]?key|aws[_-]?secret|session[_-]?(id|token)|auth)($|[_-])/i;

/** Values that look like real secret material regardless of the param name. */
const SECRET_VALUE_RES: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /\bghp_[A-Za-z0-9]{30,}\b/, // GitHub token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack token
  /[A-Za-z0-9+/]{100,}={0,2}/, // long base64 blob (exfiltrated data)
  /\b[0-9a-fA-F]{64,}\b/, // long hex blob
];

const MAX_QUERY_VALUE = 256; // a single value longer than this reads as a payload
const MAX_QUERY_TOTAL = 512; // total query string longer than this reads as a dump

/** Bare-IP hosts that are safe to fetch (dev servers, LAN, link-local). */
function isExemptIpHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost" || h === "::1") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // not a bare IPv4 → handled elsewhere
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10) return true; // loopback, private
  if (a === 192 && b === 168) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

function isBareIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":"); // IPv4 or IPv6
}

const denyWebfetchExfil: Policy = {
  name: "Deny WebFetch exfil URLs",
  description:
    "Blocks WebFetch to URLs shaped like data exfiltration: secrets in the query/userinfo, oversized query payloads, or bare public IP hosts",
  action: "deny",
  handler: async (call) => {
    if (call.tool !== "WebFetch") return;
    const raw = call.args.url;
    if (typeof raw !== "string") return;

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return; // unparseable — let downstream handle it
    }

    // Credentials embedded in the URL (http://user:pass@host).
    if (url.username || url.password) {
      return "This WebFetch URL embeds credentials (user:pass@host). Refusing to auto-approve a request that carries secrets in the URL.";
    }

    // Bare public IP host — common C2/exfil target. Dev/LAN IPs are exempt.
    if (isBareIp(url.hostname) && !isExemptIpHost(url.hostname)) {
      return `This WebFetch targets a bare public IP (${url.hostname}). Fetching from raw IPs is a common exfiltration/C2 pattern — use a hostname or confirm manually.`;
    }

    const query = url.search.slice(1); // drop leading '?'
    if (query.length > MAX_QUERY_TOTAL) {
      return `This WebFetch URL carries an oversized query string (${query.length} chars) — that reads like a data payload, not a fetch. Confirm manually if intended.`;
    }

    for (const [key, value] of url.searchParams) {
      if (SECRET_KEY_RE.test(key)) {
        return `This WebFetch URL puts a secret-shaped parameter ("${key}") in the query string. Refusing to auto-send credentials over a URL.`;
      }
      if (value.length > MAX_QUERY_VALUE) {
        return `This WebFetch URL has an oversized query value (${value.length} chars in "${key}") — that reads like exfiltrated data.`;
      }
    }

    // Secret material anywhere in the URL (path, fragment, or query value).
    for (const re of SECRET_VALUE_RES) {
      if (re.test(raw)) {
        return "This WebFetch URL contains something that looks like secret material (key, token, or long encoded blob). Refusing to auto-send it.";
      }
    }
  },
};

export default denyWebfetchExfil;
