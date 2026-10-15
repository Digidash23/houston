/**
 * Reading one live-view message. Protocol v3 grows additively, so a message
 * type this client does not know yet is skipped, never an error; a known type
 * that breaks its shape is the drift worth reporting.
 */

import {
  type BrowserLiveEvent,
  parseBrowserLiveEvent,
} from "@houston/wire-types";

const KNOWN: ReadonlySet<string> = new Set<BrowserLiveEvent["type"]>([
  "frame",
  "page",
  "status",
]);

/**
 * The event `raw` carries, or null when it is a type this client does not
 * know. A malformed known type goes to `onMalformed` (and is skipped) when
 * given, else throws.
 */
export function readLiveEvent(
  raw: unknown,
  onMalformed?: (error: unknown) => void,
): BrowserLiveEvent | null {
  const type =
    raw !== null && typeof raw === "object"
      ? (raw as { type?: unknown }).type
      : undefined;
  if (typeof type === "string" && !KNOWN.has(type)) return null;
  try {
    return parseBrowserLiveEvent(raw);
  } catch (err) {
    if (!onMalformed) throw err;
    onMalformed(err);
    return null;
  }
}
