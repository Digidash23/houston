import { lookup as osLookupAll, Resolver } from "node:dns/promises";
import { limiter, shareInFlight } from "./fence-limit";
import type { PrivateNetworks } from "./ip-ranges";

export { limiter } from "./fence-limit";

/** One DNS answer. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/**
 * Every address a name resolves to. `signal` aborts when the browser's
 * connection is gone: a lookup still queued for it is then skipped. Injected
 * by tests; {@link lookupFor} otherwise.
 */
export type FenceLookup = (
  host: string,
  signal?: AbortSignal,
) => Promise<readonly ResolvedAddress[]>;

/** The two queries the managed-cloud fence asks; `Resolver` has both. */
export interface FenceResolver {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
}

/** The operating system's resolver: `dns.lookup(host, { all: true })`. */
export type OsLookupAll = (host: string) => Promise<readonly ResolvedAddress[]>;

/** Per query try, then the whole lookup: a slow server never holds a page. */
const TRY_TIMEOUT_MS = 2_500;
const TRIES = 2;
const LOOKUP_DEADLINE_MS = 8_000;
/** c-ares lookups in flight at once; the rest wait their turn. */
const MAX_IN_FLIGHT = 8;
/** OS lookups at once: each holds one of libuv's 4 pool threads. */
const MAX_OS_IN_FLIGHT = 2;

const lookups: Partial<Record<PrivateNetworks, FenceLookup>> = {};

/** Answers that mean "this name has no such records", not a failure. */
const NO_RECORDS = new Set(["ENODATA", "ENOTFOUND", "ENONAME", "NOTFOUND"]);

/**
 * The fence's resolver for a deployment, one per process and mode. On the
 * managed cloud ("blocked") it is c-ares ({@link caresLookup}). Where private
 * networks are allowed (desktop, self-host) it is the OS's own resolver
 * ({@link osLookup}): intranet names only it knows (search domains, the hosts
 * file, mDNS `.local`, macOS split DNS) must work there. Either way every
 * answer is judged by the same address checks (fence-target.ts).
 */
export function lookupFor(privateNetworks: PrivateNetworks): FenceLookup {
  const made =
    lookups[privateNetworks] ??
    (privateNetworks === "blocked" ? caresLookup() : osLookup());
  lookups[privateNetworks] = made;
  return made;
}

/**
 * Resolve with c-ares (`dns.promises.Resolver`), not `dns.lookup`: lookup
 * runs getaddrinfo on libuv's 4-thread pool, which the runtime's file I/O
 * shares, so a page naming a few slow attacker-run DNS zones could stall the
 * whole runtime. c-ares is asynchronous on the event loop, each query has a
 * timeout, the lookup a deadline, and only {@link MAX_IN_FLIGHT} run at once.
 * It asks DNS only: no hosts file, search domains or mDNS, none of which the
 * managed cloud's sandboxes need.
 */
export function caresLookup(
  resolver: FenceResolver = new Resolver({
    timeout: TRY_TIMEOUT_MS,
    tries: TRIES,
  }),
  deadlineMs = LOOKUP_DEADLINE_MS,
  maxInFlight = MAX_IN_FLIGHT,
): FenceLookup {
  const limit = limiter(maxInFlight);
  // The slot frees at the deadline: c-ares holds no thread past it.
  return shareInFlight((host, signal) =>
    limit(() => withDeadline(resolveBoth(resolver, host), deadlineMs), signal),
  );
}

/**
 * Resolve through the OS (getaddrinfo) for desktop and self-host. getaddrinfo
 * cannot be cancelled and holds a libuv pool thread until it returns, so the
 * slot is held until the OS answers (only {@link MAX_OS_IN_FLIGHT}, leaving
 * the pool's other threads to file I/O), and so is the per-host share: a
 * re-ask after a caller's deadline joins the running lookup rather than
 * taking a second slot. Each caller's deadline counts from its own call,
 * queueing included.
 */
export function osLookup(
  lookupAll: OsLookupAll = (host) => osLookupAll(host, { all: true }),
  deadlineMs = LOOKUP_DEADLINE_MS,
  maxInFlight = MAX_OS_IN_FLIGHT,
): FenceLookup {
  const limit = limiter(maxInFlight);
  const shared = shareInFlight((host, signal, hold) =>
    limit(async () => {
      hold();
      return ipv4First(await lookupAll(host));
    }, signal),
  );
  return (host, signal) => withDeadline(shared(host, signal), deadlineMs);
}

/** IPv4 first: sandboxes and many networks have no IPv6 route at all. */
function ipv4First(answers: readonly ResolvedAddress[]): ResolvedAddress[] {
  return [
    ...answers.filter((a) => a.family === 4),
    ...answers.filter((a) => a.family !== 4),
  ];
}

async function resolveBoth(
  resolver: FenceResolver,
  host: string,
): Promise<ResolvedAddress[]> {
  const [v4, v6] = await Promise.allSettled([
    resolver.resolve4(host),
    resolver.resolve6(host),
  ]);
  const answers: ResolvedAddress[] = [];
  if (v4.status === "fulfilled")
    for (const address of v4.value) answers.push({ address, family: 4 });
  if (v6.status === "fulfilled")
    for (const address of v6.value) answers.push({ address, family: 6 });
  // One family failing (no AAAA, a slow AAAA server) leaves the other's
  // answers: the proxy only ever connects to addresses it checked.
  if (answers.length > 0) return answers;
  const failures = [v4, v6].flatMap((r) =>
    r.status === "rejected" ? [r.reason as unknown] : [],
  );
  throw (
    failures.find((e) => !NO_RECORDS.has(codeOf(e))) ??
    dnsError("ENOTFOUND", host)
  );
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(dnsError("ETIMEOUT", "lookup")), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

function codeOf(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "";
}

function dnsError(code: string, host: string): Error {
  return Object.assign(new Error(`${code} ${host}`), { code });
}
