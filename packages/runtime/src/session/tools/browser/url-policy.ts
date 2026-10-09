import { BrowserToolError } from "./errors";

const WEB_SCHEMES = new Set(["http:", "https:"]);

/**
 * The origins this runtime itself answers on. A model-driven page must never
 * reach them: on a desktop the runtime trusts loopback callers.
 */
export function loopbackOrigins(port: number): string[] {
  return ["127.0.0.1", "localhost", "[::1]"].map(
    (host) => `http://${host}:${port}`,
  );
}

/**
 * Parse the address the model asked for into a web URL, or refuse it. A bare
 * host ("example.com/login") gets https, the way a person types into a browser.
 */
export function checkBrowserUrl(
  raw: string,
  blockedOrigins: readonly string[],
): URL {
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
  if (blockedOrigins.includes(url.origin))
    throw new BrowserToolError(
      "url_refused",
      "That address belongs to Houston itself, so the browser will not open it.",
    );
  return url;
}

/** Whether the page the browser ended up on (after redirects) is still allowed. */
export function landedSafely(
  current: string,
  blockedOrigins: readonly string[],
): boolean {
  if (current === "about:blank") return true;
  if (!URL.canParse(current)) return false;
  const url = new URL(current);
  return WEB_SCHEMES.has(url.protocol) && !blockedOrigins.includes(url.origin);
}
