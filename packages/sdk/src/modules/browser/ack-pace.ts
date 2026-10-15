/**
 * When a frame ack may go up on its own. Every ack alone is one POST through
 * the gateway into the agent's sandbox, so acks are coalesced: the highest
 * frame goes once {@link BROWSER_LIVE_ACK_INTERVAL_MS} have passed since the
 * first frame it covers arrived, or at once when the unacked frames fill the
 * runtime's window but for {@link ACK_HEADROOM} frames, or half its bytes:
 * the runtime keeps painting on what is left while the ack is on its way, and
 * a filling window never waits out the interval. So a busy page costs one POST
 * per few frames and a quiet one at most four a second.
 *
 * The window is the one the runtime advertised on its status; until one does
 * (a runtime older than the field never does), the old two-frame window, so a
 * new client acks an old runtime's every frame.
 */

import {
  BROWSER_LIVE_LEGACY_WINDOW,
  type BrowserLiveWindow,
} from "@houston/wire-types";
import type { Clock } from "../../ports";

/** The longest a received frame waits before an ack covering it goes alone. */
export const BROWSER_LIVE_ACK_INTERVAL_MS = 250;
/** Frames of window left for the runtime to send while an eager ack travels. */
const ACK_HEADROOM = 2;

/** Unacked frames that send an ack at once, without waiting out the interval. */
export function eagerFrames(window: BrowserLiveWindow): number {
  return Math.max(1, window.frames - ACK_HEADROOM);
}

/** Unacked frame bytes (base64 length) that send an ack at once. */
export function eagerBytes(window: BrowserLiveWindow): number {
  return window.bytes / 2;
}

export function ackPacer(clock: Clock, wake: () => void) {
  /** Frames received and not yet known acked, oldest first. */
  let frames: { seq: number; bytes: number }[] = [];
  let window = BROWSER_LIVE_LEGACY_WINDOW;
  let timer: number | null = null;
  let due = false;

  const disarm = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    due = false;
  };

  return {
    /** The runtime's window, from its status (absent: an older runtime). */
    windowed(advertised: BrowserLiveWindow | undefined): void {
      window = advertised ?? BROWSER_LIVE_LEGACY_WINDOW;
    },
    /** A frame newer than any before it arrived, `bytes` its base64 length. */
    received(seq: number, bytes: number): void {
      frames.push({ seq, bytes });
    },
    /** The runtime has every ack up to `seq`. */
    acked(seq: number): void {
      frames = frames.filter((sent) => sent.seq > seq);
    },
    /**
     * Whether an ack for the frames past `covered` (acked or on the wire)
     * goes now. When not yet, the interval is armed and `wake` runs at its end.
     */
    ready(covered: number): boolean {
      const waiting = frames.filter((sent) => sent.seq > covered);
      if (waiting.length === 0) {
        disarm();
        return false;
      }
      const bytes = waiting.reduce((sum, sent) => sum + sent.bytes, 0);
      if (
        due ||
        waiting.length >= eagerFrames(window) ||
        bytes >= eagerBytes(window)
      ) {
        disarm();
        return true;
      }
      timer ??= clock.setTimeout(() => {
        timer = null;
        due = true;
        wake();
      }, BROWSER_LIVE_ACK_INTERVAL_MS);
      return false;
    },
    stop: disarm,
  };
}
