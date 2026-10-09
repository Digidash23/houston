import type { ChannelProviderId } from "./types";

/**
 * The window after a channel hand-off in which the connection it produces can
 * appear. The connection is made on the gateway (a Slack authorization, a
 * WhatsApp message sent from the person's phone), never in the surface that
 * started it, so nothing tells that surface when it lands: it polls the
 * connections list while a watch is outstanding and stops the moment the
 * provider's connection arrives, or when the person is plainly not coming back.
 *
 * A watch belongs to ONE provider and counts only that provider's connections,
 * so a Slack connection landing never ends a WhatsApp wait, and starting one
 * hand-off never restarts the other's clock.
 *
 * Dependency-free and erasable-syntax-only: the app's node:test entry points
 * load it through the `@houston/sdk/channels/watch` subpath.
 */

/**
 * The shortest watch. A code that lives longer (a WhatsApp code, ten minutes)
 * stretches the watch to its expiry: that code is scanned on ANOTHER device, so
 * the window that shows it never regains focus to refetch on its own.
 */
export const CHANNEL_WATCH_MS = 3 * 60_000;

/** How often the connections list is read while a watch is outstanding. */
export const CHANNEL_WATCH_POLL_MS = 5_000;

/** The one field of a connection a watch reads. */
export interface WatchedConnection {
  provider: ChannelProviderId;
}

/** A hand-off in progress: whose, the list as it was, and when to stop. */
export interface ChannelWatch {
  provider: ChannelProviderId;
  /** The provider's connections when the hand-off started. */
  connections: number;
  /** Epoch ms after which the watch stops polling. */
  until: number;
}

function providerCount(
  provider: ChannelProviderId,
  connections: readonly WatchedConnection[],
): number {
  return connections.filter((item) => item.provider === provider).length;
}

/**
 * Start watching for `provider`'s next connection. `expiresAt` is the code the
 * hand-off minted, when it minted one; an unparseable expiry keeps the default.
 */
export function startChannelWatch(
  provider: ChannelProviderId,
  connections: readonly WatchedConnection[],
  now: number,
  expiresAt?: string,
): ChannelWatch {
  const expiry = expiresAt === undefined ? Number.NaN : Date.parse(expiresAt);
  const until = Number.isFinite(expiry)
    ? Math.max(now + CHANNEL_WATCH_MS, expiry)
    : now + CHANNEL_WATCH_MS;
  return {
    provider,
    connections: providerCount(provider, connections),
    until,
  };
}

/** A new connection of the watched provider: the hand-off landed. */
export function channelWatchLanded(
  watch: ChannelWatch | null | undefined,
  connections: readonly WatchedConnection[],
): boolean {
  if (!watch) return false;
  return providerCount(watch.provider, connections) > watch.connections;
}

/** Still waiting: nothing has landed and the window is open. */
export function channelWatchActive(
  watch: ChannelWatch | null | undefined,
  connections: readonly WatchedConnection[],
  now: number,
): boolean {
  if (!watch) return false;
  return !channelWatchLanded(watch, connections) && now < watch.until;
}

/** The list's poll interval: on while any watch is outstanding, else off. */
export function channelWatchPollMs(
  watches: readonly (ChannelWatch | null | undefined)[],
  connections: readonly WatchedConnection[],
  now: number,
): number | false {
  return watches.some((watch) => channelWatchActive(watch, connections, now))
    ? CHANNEL_WATCH_POLL_MS
    : false;
}
