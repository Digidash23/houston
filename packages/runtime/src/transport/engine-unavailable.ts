import type { RouteContext } from "./http-helpers";

/**
 * The engine's "not here, not now" answer — the gateway's waking shape, byte
 * for byte. Every shipped client reads `503 {"error":"engine unavailable"}` as
 * a state, not a failure: it re-sends the SAME message (same nonce, so a late
 * acceptance can never double it) along its wake ladder while the user's bubble
 * stays pending, and shows nothing. A new reason string would instead be a red
 * toast on every one of them.
 */
export function engineUnavailable(
  ctx: RouteContext,
  detail: string,
  retryAfterSeconds: number,
): void {
  ctx.res.writeHead(503, {
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": String(retryAfterSeconds),
  });
  ctx.res.end(JSON.stringify({ error: "engine unavailable", detail }));
}
