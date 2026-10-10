/**
 * The pure half of the input batcher: what may merge, how a long paste splits,
 * and how many queued events fit one POST. The runtime refuses a whole body
 * past `BROWSER_LIVE_MAX_BODY_BYTES` (UTF-8) and a text event past
 * `BROWSER_LIVE_MAX_TEXT`, so the client never builds one.
 */

import {
  BROWSER_LIVE_MAX_BODY_BYTES,
  BROWSER_LIVE_MAX_EVENTS,
  BROWSER_LIVE_MAX_TEXT,
  type BrowserLiveInput,
} from "@houston/wire-types";

/** Body room kept for the `ack`, `batch` and `finish` around the events. */
const ENVELOPE_BYTES = 1024;
/** One text event's encoded ceiling: any single event fits a body with room. */
export const TEXT_EVENT_BYTES = 16 * 1024;

const encoder = new TextEncoder();

/** A value's size as the POST body carries it: JSON, UTF-8. */
export function encodedBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** One code point's JSON-escaped UTF-8 size; printable ASCII takes the fast path. */
function charBytes(ch: string): number {
  const code = ch.charCodeAt(0);
  if (
    ch.length === 1 &&
    code >= 0x20 &&
    code < 0x7f &&
    ch !== '"' &&
    ch !== "\\"
  )
    return 1;
  return encodedBytes(ch) - 2;
}

export function isMove(event: BrowserLiveInput): boolean {
  return event.type === "mouse" && event.action === "move";
}

/**
 * Typed or pasted text as events the runtime accepts: each at most
 * `BROWSER_LIVE_MAX_TEXT` UTF-16 units and {@link TEXT_EVENT_BYTES} encoded,
 * never split inside a surrogate pair.
 */
export function textEvents(text: string): BrowserLiveInput[] {
  const out: BrowserLiveInput[] = [];
  let chunk = "";
  let bytes = 2; // the JSON string's quotes
  for (const ch of text) {
    const cost = charBytes(ch);
    if (
      chunk &&
      (chunk.length + ch.length > BROWSER_LIVE_MAX_TEXT ||
        bytes + cost > TEXT_EVENT_BYTES)
    ) {
      out.push({ type: "text", text: chunk });
      chunk = "";
      bytes = 2;
    }
    chunk += ch;
    bytes += cost;
  }
  if (chunk) out.push({ type: "text", text: chunk });
  return out;
}

/** `next` folded into the queue's tail, or `null` when it must stay its own event. */
export function merged(
  last: BrowserLiveInput,
  next: BrowserLiveInput,
): BrowserLiveInput | null {
  if (isMove(last) && isMove(next)) return next;
  if (last.type === "wheel" && next.type === "wheel")
    return { ...next, dx: last.dx + next.dx, dy: last.dy + next.dy };
  if (last.type === "text" && next.type === "text") {
    const text = last.text + next.text;
    const fits =
      text.length <= BROWSER_LIVE_MAX_TEXT &&
      encodedBytes(text) <= TEXT_EVENT_BYTES;
    return fits ? { type: "text", text } : null;
  }
  return null;
}

/**
 * How many events at the queue's head the next POST carries: at most
 * `BROWSER_LIVE_MAX_EVENTS` and the body's byte budget, never zero (a lone
 * oversized event is sent and the runtime's refusal reported).
 */
export function batchSize(queue: readonly BrowserLiveInput[]): number {
  const budget = BROWSER_LIVE_MAX_BODY_BYTES - ENVELOPE_BYTES;
  let bytes = 0;
  let n = 0;
  while (n < queue.length && n < BROWSER_LIVE_MAX_EVENTS) {
    bytes += encodedBytes(queue[n]) + 1;
    if (n > 0 && bytes > budget) break;
    n++;
  }
  return n;
}

/**
 * A failed batch as its retry re-sends it. Moves are stale by the time a retry
 * lands (every press carries its own position); only a trailing one still
 * says where the pointer is.
 */
export function forRetry(
  events: readonly BrowserLiveInput[],
): BrowserLiveInput[] {
  return events.filter((e, i) => !isMove(e) || i === events.length - 1);
}
