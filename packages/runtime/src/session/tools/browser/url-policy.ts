import { isIP } from "node:net";
import { BrowserToolError } from "./errors";

const WEB_SCHEMES = new Set(["http:", "https:"]);

/**
 * Hosts the model may not ask for: this machine (the runtime, the host, a
 * local model server, a sandbox daemon), link-local (cloud metadata), and the
 * "any address" forms that reach this machine on macOS and Linux. Chromium
 * enforces the same fence on every request (launch.ts); this check is what
 * turns an `open` into a refusal the model can read instead of a net error.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "metadata" || host.endsWith(".internal")) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 127 || a === 0 || (a === 169 && b === 254);
  }
  if (isIP(host) === 6)
    return (
      host === "::" ||
      host === "::1" ||
      /^fe[89ab]/.test(host) ||
      // WHATWG prints an IPv4-mapped loopback as ::ffff:7f00:1.
      /^::ffff:(7f|0:|a9fe:)/.test(host)
    );
  return false;
}

/**
 * Parse the address the model asked for into a web URL, or refuse it. A bare
 * host ("example.com/login") gets https, the way a person types into a browser.
 */
export function checkBrowserUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed)
    throw new BrowserToolError("invalid_action", "Give the page's address.");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch (error) {
    throw new BrowserToolError(
      "invalid_action",
      `'${raw}' is not a web address.`,
      { cause: error },
    );
  }
  if (!WEB_SCHEMES.has(url.protocol))
    throw new BrowserToolError(
      "url_refused",
      `The browser only opens web pages (http or https), not '${url.protocol}' addresses. Use the file tools for files on disk.`,
    );
  if (isBlockedHost(url.hostname))
    throw new BrowserToolError(
      "url_refused",
      "That address points at this computer itself, so the browser will not open it.",
    );
  return url;
}

/** Whether the page the browser ended up on (after redirects) is still allowed. */
export function landedSafely(current: string): boolean {
  if (current === "about:blank") return true;
  if (!URL.canParse(current)) return false;
  const url = new URL(current);
  return WEB_SCHEMES.has(url.protocol) && !isBlockedHost(url.hostname);
}
