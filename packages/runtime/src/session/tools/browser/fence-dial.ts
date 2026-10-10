import type { Socket } from "node:net";
import { abortError } from "./fence-limit";
import { answer } from "./fence-splice";
import type { FenceVerdict } from "./fence-target";

/** Opens a connection to one address the fence checked. Injected by tests. */
export type FenceConnect = (address: string, port: number) => Socket;

/** One address this long without a connection: try the next. */
export const ATTEMPT_TIMEOUT_MS = 5_000;

/**
 * Judging and connecting together, at most: past it the browser gets the 502.
 * Above the lookup deadline (8 s) plus a few connect attempts.
 */
export const CONNECT_BOUND_MS = 30_000;

/**
 * Connect to the first of `addresses` (every one already checked) that
 * accepts, in order, each attempt cut after `attemptMs`. A name with a dead
 * first answer (an IPv6 address on a sandbox with no IPv6 route) still opens.
 * Rejects with the last attempt's failure; `signal` aborting cuts the attempt
 * in progress and tries no other.
 */
export async function dial(
  addresses: readonly string[],
  port: number,
  connect: FenceConnect,
  attemptMs: number = ATTEMPT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<Socket> {
  let last: unknown = new Error("no address to connect to");
  for (const address of addresses) {
    if (signal?.aborted) throw abortError();
    const socket = connect(address, port);
    try {
      await connected(socket, attemptMs, signal);
      return socket;
    } catch (error) {
      socket.destroy();
      last = error;
    }
  }
  throw last;
}

function connected(
  socket: Socket,
  attemptMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (error?: Error) => {
      socket.off("connect", onConnect);
      socket.off("error", settle);
      signal?.removeEventListener("abort", onAbort);
      socket.setTimeout(0);
      if (error) reject(error);
      else resolve();
    };
    const onConnect = () => settle();
    const onAbort = () => settle(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", onConnect);
    socket.once("error", settle);
    socket.setTimeout(attemptMs, () =>
      settle(
        Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT" }),
      ),
    );
  });
}

/** Opens a connection to the first of the checked addresses that accepts. */
export type Open = (
  addresses: readonly string[],
  port: number,
  signal: AbortSignal,
) => Promise<Socket>;

/** Where a host may go; `signal` aborts when the answer is no longer wanted. */
export type Judge = (
  host: string,
  signal: AbortSignal,
) => Promise<FenceVerdict>;

/**
 * The judged site's connection, or null once the browser was answered (or is
 * gone). Judging and connecting share one bound, `boundMs`, and both stop as
 * soon as the browser's connection closes.
 */
export async function connectJudged(
  client: Socket,
  judge: Judge,
  open: Open,
  host: string,
  port: number,
  boundMs: number = CONNECT_BOUND_MS,
): Promise<Socket | null> {
  const stop = new AbortController();
  const onClose = () => stop.abort();
  client.once("close", onClose);
  const timer = setTimeout(() => stop.abort(), boundMs);
  try {
    return await judgeAndOpen(client, judge, open, host, port, stop.signal);
  } finally {
    clearTimeout(timer);
    client.off("close", onClose);
  }
}

async function judgeAndOpen(
  client: Socket,
  judge: Judge,
  open: Open,
  host: string,
  port: number,
  signal: AbortSignal,
): Promise<Socket | null> {
  const verdict = await orAbort(judge(host, signal), signal);
  if (client.destroyed) return null;
  if (verdict === null) {
    answer(client, "unreachable");
    return null;
  }
  if (verdict.kind !== "allowed") {
    answer(client, verdict.kind);
    return null;
  }
  let upstream: Socket;
  try {
    upstream = await open(verdict.addresses, port, signal);
  } catch {
    // Every checked address refused or timed out, or the bound ran out: the
    // site's state, not ours.
    if (!client.destroyed) answer(client, "unreachable");
    return null;
  }
  if (client.destroyed || signal.aborted) {
    upstream.destroy();
    if (!client.destroyed) answer(client, "unreachable");
    return null;
  }
  return upstream;
}

/** `work`'s result, or null as soon as `signal` aborts, whichever is first. */
function orAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(null);
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
