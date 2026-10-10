import { hasSessionRefresher, refreshLiveToken } from "../session-refresh";
import { describeBearer, formatBearerDescription } from "./bearer-claims";

/**
 * How the 401 recovery (`./bearer-recovery.ts`) asks the session refresher
 * for a bearer worth replaying. Two field shapes live here, both wake-from-
 * sleep (the only time a desktop's clocks, timers and sockets all resume at
 * once), and neither is the transport's to fix at the source: the refresher
 * belongs to the shell that configured identity.
 */

/** True in hosted control-plane mode (the cloud web app and the desktop cloud
 *  profile both set the flag). Local hosts never set it, so the signed-out
 *  short-circuit cannot affect them. */
export const inControlPlaneMode = (): boolean =>
  typeof window !== "undefined" &&
  (window as { __HOUSTON_CP__?: boolean }).__HOUSTON_CP__ === true;

/** A bearer this close to its `exp` is refused before a replay can land. */
export const MIN_BEARER_REMAINING_S = 60;

/** Whether `bearer` is expired, or about to be, by its own `exp` claim. One
 *  without a readable claim is trusted: the gateway is the judge. */
export function isBearerExpiredByClaims(
  bearer: string,
  nowMs: number = Date.now(),
): boolean {
  const expiresInS = describeBearer(bearer, nowMs)?.expiresInS;
  return expiresInS != null && expiresInS <= MIN_BEARER_REMAINING_S;
}

const nextMacrotask = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Ask the session refresher for a bearer, giving a hosted page ONE extra
 * macrotask when the refresher is not installed at the instant a 401 lands.
 *
 * Observed in the field (PRODUCT-1737): after a laptop wake, the first 401
 * response processed found no refresher on the window and surfaced the
 * gateway's raw answer, while its sibling responses two milliseconds later
 * refreshed and replayed normally. The gap is a single turn of the event loop,
 * so that is what this waits — never longer, and never at all when the
 * refresher is where it belongs. A page that still has no refresher after the
 * tick is a static-token host or the pre-mount boot window, and the warn is
 * the breadcrumb that tells the next Sentry event which of the two it was.
 */
async function refreshBearer(): Promise<string | null> {
  const fresh = await refreshLiveToken();
  if (fresh || !inControlPlaneMode() || hasSessionRefresher()) return fresh;
  await nextMacrotask();
  if (hasSessionRefresher()) return refreshLiveToken();
  console.warn(
    "[gateway-auth] 401 with no session refresher installed on a hosted page; surfacing the gateway's answer as-is",
  );
  return null;
}

/**
 * A bearer the refresher hands back is not replayed on faith: its own `exp`
 * can already be in the past. The shape (HOUSTON-APP-5HZ): a refresh request
 * went out, the laptop slept, and the answer was delivered on wake, so the
 * session store saw an hour-fresh `expires_in` while the gateway saw a token
 * 27 minutes dead. Replaying it earned the one loud "refused a freshly minted
 * bearer" report (PRODUCT-1812) for a token that was never fresh. The claims
 * already give the answer, so the bearer is not sent; the refresher is asked
 * once more. N joiners of the first refresh resume in one flush and share that
 * second refresh through the same single-flight latch.
 *
 * Once only: a client clock hours ahead of Google's makes EVERY token look
 * expired locally while the gateway accepts it, so the second answer is
 * returned as is and the verifier decides. Never a lockout from a wrong clock.
 */
export async function refreshUsableBearer(): Promise<string | null> {
  const fresh = await refreshBearer();
  if (!fresh || !isBearerExpiredByClaims(fresh)) return fresh;
  if (noteDiscarded(fresh)) {
    // Sentry scrubs any breadcrumb containing "auth", so this prefix must not.
    console.warn(
      "[gateway-bearer] the refresher handed back a bearer already expired by its claims; " +
        `discarded ${formatBearerDescription(describeBearer(fresh))}, asking once more`,
    );
  }
  return refreshLiveToken();
}

/** Bearers already discarded for their claims: N joiners of one refresh all
 *  see the same answer in one flush, and the breadcrumb is written once per
 *  bearer, not once per joiner. Bounded like the rejected-bearer memory. */
const DISCARDED_LIMIT = 8;
const discarded: string[] = [];

/** Record a discard; true when this bearer had not been discarded before. */
function noteDiscarded(bearer: string): boolean {
  if (discarded.includes(bearer)) return false;
  discarded.push(bearer);
  if (discarded.length > DISCARDED_LIMIT) discarded.shift();
  return true;
}

/** Test seam. */
export function resetDiscardedBearers(): void {
  discarded.length = 0;
}
