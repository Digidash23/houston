import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

/** An address block: `bits` wide (32 or 128), the first `length` bits fixed. */
export interface IpPrefix {
  bits: 32 | 128;
  base: bigint;
  length: number;
}

/**
 * Whether the browser may reach private networks. On Houston's managed cloud
 * (`HOUSTON_MANAGED_CLOUD=1`, set by the E2B template and engine pods) those
 * ranges are E2B's and GCP's own internal network, so they are blocked. On a
 * self-hosted or desktop install they are often the team's own intranet apps,
 * which the person may legitimately want the agent to open.
 */
export type PrivateNetworks = "blocked" | "allowed";

type Env = Record<string, string | undefined>;

/** The one place the deployment decides {@link PrivateNetworks}. */
export function privateNetworksFor(env: Env): PrivateNetworks {
  return env.HOUSTON_MANAGED_CLOUD === "1" ? "blocked" : "allowed";
}

/**
 * Never reachable, anywhere: this machine (0/8, 127/8, ::/8, which also holds
 * `::1`, `::` and the IPv4-mapped forms), link-local / cloud metadata
 * (169.254/16, fe80::/9, which takes in the old site-local fec0::/10 too),
 * and the metadata servers outside link-local: AWS's IPv6 one and Alibaba's.
 * This machine's own interface addresses join them per proxy
 * ({@link ownAddresses}).
 */
export const ALWAYS_BLOCKED_PREFIXES: readonly string[] = [
  "0.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "::/8",
  "fe80::/9",
  "fd00:ec2::254/128",
  "100.100.100.200/32",
];

/**
 * Private networks, blocked only on the managed cloud: RFC1918, carrier-grade
 * NAT (100.64/10, which E2B and most clouds use internally) and IPv6
 * unique-local (fc00::/7).
 */
export const PRIVATE_NETWORK_PREFIXES: readonly string[] = [
  "10.0.0.0/8",
  "100.64.0.0/10",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "fc00::/7",
];

/** The ones that are this machine itself, for a refusal that says so. */
const THIS_MACHINE = ["0.0.0.0/8", "127.0.0.0/8", "::/8"];

function v4(text: string): bigint {
  return text
    .split(".")
    .reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
}

function v6(text: string): bigint {
  // A dotted IPv4 tail ("::ffff:1.2.3.4") is two groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  const hex = dotted
    ? text.slice(0, -dotted.length) +
      [v4(dotted) >> 16n, v4(dotted) & 0xffffn]
        .map((g) => g.toString(16))
        .join(":")
    : text;
  const [head = "", tail] = hex.split("::");
  const groups = (part: string) => (part ? part.split(":") : []);
  const missing = 8 - groups(head).length - groups(tail ?? "").length;
  const all = [
    ...groups(head),
    ...(tail === undefined ? [] : Array<string>(missing).fill("0")),
    ...groups(tail ?? ""),
  ];
  return all.reduce((acc, g) => (acc << 16n) | BigInt(`0x${g}`), 0n);
}

const MAPPED_V4 = 0xffffn << 32n;

/**
 * An IP literal as a number, or null for a name. IPv4-mapped IPv6 reads as
 * the IPv4 address it carries, the way the network treats it.
 */
export function parseIp(
  host: string,
): { bits: 32 | 128; value: bigint } | null {
  // A zone ("fe80::1%en0") names the interface, not the address.
  const bare = host.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(bare);
  if (family === 4) return { bits: 32, value: v4(bare) };
  if (family !== 6) return null;
  const value = v6(bare.toLowerCase());
  if (value >> 32n === MAPPED_V4 >> 32n)
    return { bits: 32, value: value & 0xffff_ffffn };
  return { bits: 128, value };
}

export function parsePrefix(cidr: string): IpPrefix {
  const [address = "", length = ""] = cidr.split("/");
  const bits = isIP(address) === 4 ? 32 : 128;
  return {
    bits,
    base: bits === 32 ? v4(address) : v6(address),
    length: Number(length),
  };
}

function contains(prefix: IpPrefix, bits: number, value: bigint): boolean {
  if (prefix.bits !== bits) return false;
  const shift = BigInt(bits - prefix.length);
  return value >> shift === prefix.base >> shift;
}

const ALWAYS = ALWAYS_BLOCKED_PREFIXES.map(parsePrefix);
const PRIVATE = PRIVATE_NETWORK_PREFIXES.map(parsePrefix);
const LOCAL = THIS_MACHINE.map(parsePrefix);
const V6_LINK_LOCAL = parsePrefix("fe80::/10");

/**
 * IPv6 link-local (fe80::/10, zone or not). mDNS names (`nas.local`) answer
 * one beside their usable address, so the fence drops it from a name's
 * answers rather than refusing the name; it is still never dialed.
 */
export function isIpv6LinkLocal(address: string): boolean {
  const ip = parseIp(address);
  return ip !== null && contains(V6_LINK_LOCAL, ip.bits, ip.value);
}

/** This machine's own addresses, as `parseIp` keys (`<bits>:<value>`). */
export type OwnAddresses = ReadonlySet<string>;

const NO_OWN_ADDRESSES: OwnAddresses = new Set();

function ipKey(ip: { bits: number; value: bigint }): string {
  return `${ip.bits}:${ip.value}`;
}

/**
 * Every address on this machine's interfaces, read when a fence proxy starts.
 * With private networks allowed (desktop, self-host) the machine's LAN or
 * public address would otherwise reach whatever listens on 0.0.0.0 here,
 * the host's own port included. `interfaces` is the tests' seam.
 */
export function ownAddresses(
  interfaces: Record<
    string,
    readonly { address: string }[] | undefined
  > = networkInterfaces(),
): OwnAddresses {
  const own = new Set<string>();
  for (const entries of Object.values(interfaces))
    for (const entry of entries ?? []) {
      const ip = parseIp(entry.address);
      if (ip) own.add(ipKey(ip));
    }
  return own;
}

/** Where an IP literal points, when the browser may not go there. */
export function blockedAddress(
  host: string,
  privateNetworks: PrivateNetworks,
  own: OwnAddresses = NO_OWN_ADDRESSES,
): "this_machine" | "link_local" | "private_network" | null {
  const ip = parseIp(host);
  if (!ip) return null;
  const within = (p: IpPrefix) => contains(p, ip.bits, ip.value);
  if (LOCAL.some(within) || own.has(ipKey(ip))) return "this_machine";
  if (ALWAYS.some(within)) return "link_local";
  if (privateNetworks === "blocked" && PRIVATE.some(within))
    return "private_network";
  return null;
}
