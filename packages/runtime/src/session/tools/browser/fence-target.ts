import { isIP } from "node:net";
import type { FenceLookup } from "./fence-resolve";
import type { OwnAddresses, PrivateNetworks } from "./ip-ranges";
import { blockedAddress, isIpv6LinkLocal, parseIp } from "./ip-ranges";
import { blockedHost } from "./url-policy";

export type { FenceLookup, ResolvedAddress } from "./fence-resolve";

/** Addresses a connect tries, at most: a long answer list is not a retry loop. */
export const MAX_CONNECT_ADDRESSES = 4;

/**
 * Where a request may go. `allowed` carries the addresses the proxy then
 * connects to, in order, every one of them checked, so the name is never
 * resolved a second time (a DNS rebinding answer between the check and the
 * connect changes nothing). `unreachable` is an ordinary failure (no such
 * name), not a refusal.
 */
export type FenceVerdict =
  | { kind: "allowed"; addresses: readonly string[] }
  | { kind: "refused" }
  | { kind: "unreachable" };

/** A request target's host as written: brackets and one root dot off. */
export function bareHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

/**
 * Decide a request's target: a blocked name or literal is refused outright
 * (url-policy.ts), and a name is refused when ANY of its answers is blocked
 * under `privateNetworks` or is one of this machine's `own` addresses
 * (ip-ranges.ts), so a public name pointing at 127.0.0.1, at the metadata
 * server or (on the managed cloud) at a private network never gets through.
 * The one exception: IPv6 link-local answers beside other answers are dropped
 * (never dialed) and the rest judged, since mDNS names carry one routinely.
 */
export async function judgeTarget(
  rawHost: string,
  privateNetworks: PrivateNetworks,
  lookup: FenceLookup,
  own?: OwnAddresses,
): Promise<FenceVerdict> {
  const host = bareHost(rawHost);
  const refused = (address: string) =>
    parseIp(address) === null ||
    blockedAddress(address, privateNetworks, own) !== null;
  if (!host || blockedHost(host, privateNetworks)) return { kind: "refused" };
  if (isIP(host))
    return refused(host)
      ? { kind: "refused" }
      : { kind: "allowed", addresses: [host] };
  let answers: readonly { address: string }[];
  try {
    answers = await lookup(host);
  } catch (error) {
    // NXDOMAIN and friends: the page simply does not exist.
    if (isDnsMiss(error)) return { kind: "unreachable" };
    throw error;
  }
  if (answers.length === 0) return { kind: "unreachable" };
  const usable = answers.filter((a) => !isIpv6LinkLocal(a.address));
  const judged = usable.length > 0 ? usable : answers;
  if (judged.some((a) => refused(a.address))) return { kind: "refused" };
  const addresses = [...new Set(judged.map((a) => a.address))];
  return {
    kind: "allowed",
    addresses: addresses.slice(0, MAX_CONNECT_ADDRESSES),
  };
}

function isDnsMiss(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    /^(ENOTFOUND|ENODATA|EAI_AGAIN|ESERVFAIL|ETIMEOUT|ENONAME|EAI_FAIL|EREFUSED|EBADNAME|EBADRESP|ECONNREFUSED)$/.test(
      error.code,
    )
  );
}

/** `host:port` of a CONNECT line, `[v6]:port` included; null if malformed. */
export function parseAuthority(
  authority: string,
): { host: string; port: number } | null {
  const match = /^(\[[^\]]+\]|[^:[\]]+):(\d{1,5})$/.exec(authority);
  const port = Number(match?.[2]);
  if (!match?.[1] || !Number.isInteger(port) || port < 1 || port > 65_535)
    return null;
  return { host: match[1], port };
}
