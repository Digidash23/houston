import type { Socket } from "node:net";
import { type ProxyAnswerKind, proxyAnswer, TUNNEL_OPEN } from "./fence-wire";

/** A connection quiet this long is dropped (a WebSocket's own pings beat it). */
export const IDLE_MS = 5 * 60_000;

/** The proxy's own answer, then the connection closes. */
export function answer(client: Socket, kind: ProxyAnswerKind): void {
  client.end(proxyAnswer(kind));
  // Drain whatever else the browser sent, so the close is not held up.
  client.resume();
}

/**
 * Cut both ends on either's error or idle timeout, and the site's end when
 * the browser's closes. A reset from the site is the site's state, not ours.
 */
export function bindEnds(client: Socket, upstream: Socket): () => void {
  const cut = () => {
    upstream.destroy();
    client.destroy();
  };
  upstream.on("error", cut);
  upstream.setTimeout(IDLE_MS, cut);
  client.setTimeout(IDLE_MS, cut);
  client.once("close", () => upstream.destroy());
  return cut;
}

/**
 * A CONNECT tunnel: join the browser's connection to the site's, opened and
 * connected already; either end closing ends both. What runs inside is TLS
 * (or a WebSocket) to the ONE host the fence judged.
 */
export function tunnel(client: Socket, upstream: Socket, first: Buffer): void {
  bindEnds(client, upstream);
  client.write(TUNNEL_OPEN);
  if (first.length > 0) upstream.write(first);
  // pipe() carries backpressure both ways and ends each side after the other.
  client.pipe(upstream);
  upstream.pipe(client);
  client.resume();
}
