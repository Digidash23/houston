import * as Sentry from "@sentry/browser";
import { resolveCapturedEventId } from "./sentry-transport";

// Per-event delivery outcome recorded by the confirming transport (sentry.ts)
// and read+cleared by `confirmDelivery`: true once Sentry accepts the event
// with a 2xx. Bounded so it can't grow unboundedly from envelopes captured
// outside a confirming capture (some envelope types carry no header event_id;
// the SDK's own GlobalHandlers integration is stripped, see initSentry).
const deliveryAccepted = new Map<string, boolean>();
const MAX_TRACKED_DELIVERIES = 64;

export function recordDelivery(eventId: string, accepted: boolean): void {
  if (deliveryAccepted.size >= MAX_TRACKED_DELIVERIES) {
    const oldest = deliveryAccepted.keys().next().value;
    if (oldest !== undefined) deliveryAccepted.delete(oldest);
  }
  deliveryAccepted.set(eventId, accepted);
}

/**
 * Flush, then answer `eventId` only if Sentry accepted that envelope with a
 * 2xx, else "". Shared by every capture whose caller tells the person it
 * landed: `captureException` (the "report sent" toast) and the bug-report
 * feedback fallback (`sentry-feedback.ts`).
 */
export async function confirmDelivery(eventId: string): Promise<string> {
  const flushed = await Sentry.flush(5000);
  // By the time flush resolves, the wrapper's send() has run for this envelope
  // and recorded its outcome. The exact microtask ordering isn't guaranteed, so
  // a missing entry is treated as not-accepted — worst case a real send shows no
  // green toast (conservative), never a false "report sent".
  const accepted = deliveryAccepted.get(eventId) === true;
  deliveryAccepted.delete(eventId);
  return resolveCapturedEventId(eventId, flushed, accepted);
}
