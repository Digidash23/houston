import { BrowserToolError } from "./errors";
import {
  blockedAddress,
  type PrivateNetworks,
  privateNetworksFor,
} from "./ip-ranges";

const WEB_SCHEMES = new Set(["http:", "https:"]);

/**
 * Defaults to what this process's own browser was launched with (launch.ts
 * reads the same env), so a check and the Chromium fence agree.
 */
const processPrivateNetworks = (): PrivateNetworks =>
  privateNetworksFor(process.env);

type BlockedKind = "this_machine" | "link_local" | "private_network";

/**
 * Hosts the model may not ask for: this machine (the runtime, the host, a
 * local model server, a sandbox daemon), link-local and cloud metadata names,
 * and on the managed cloud the private networks (ip-ranges.ts). It judges the
 * NAME only; the fence proxy (fence-proxy.ts) judges where a name resolves,
 * on every request. This check is what turns an `open` of an address into a
 * refusal the model can read before anything is fetched.
 */
export function blockedHost(
  hostname: string,
  privateNetworks: PrivateNetworks = processPrivateNetworks(),
): BlockedKind | null {
  // One root dot is the same host ("metadata.google.internal.").
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost"))
    return "this_machine";
  if (host === "metadata" || host.endsWith(".internal")) return "link_local";
  return blockedAddress(host, privateNetworks);
}

export function isBlockedHost(
  hostname: string,
  privateNetworks: PrivateNetworks = processPrivateNetworks(),
): boolean {
  return blockedHost(hostname, privateNetworks) !== null;
}

const REFUSALS = {
  this_machine:
    "That address points at this computer itself, so the browser will not open it.",
  link_local:
    "That address is not on the public web, so the browser will not open it.",
  private_network:
    "That address is on a private network, not the public web, so the browser will not open it.",
} as const satisfies Record<BlockedKind, string>;

/**
 * Parse the address the model asked for into a web URL, or refuse it. A bare
 * host ("example.com/login") gets https, the way a person types into a browser.
 */
export function checkBrowserUrl(
  raw: string,
  privateNetworks: PrivateNetworks = processPrivateNetworks(),
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
  const blocked = blockedHost(url.hostname, privateNetworks);
  if (blocked) throw new BrowserToolError("url_refused", REFUSALS[blocked]);
  return url;
}

/** Whether the page the browser ended up on (after redirects) is still allowed. */
export function landedSafely(
  current: string,
  privateNetworks: PrivateNetworks = processPrivateNetworks(),
): boolean {
  if (current === "about:blank") return true;
  if (!URL.canParse(current)) return false;
  const url = new URL(current);
  return (
    WEB_SCHEMES.has(url.protocol) &&
    !isBlockedHost(url.hostname, privateNetworks)
  );
}
