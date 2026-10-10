/**
 * The input batcher's POST plumbing: a lane is one POST at a time with its own
 * backoff (events on one, frame acks on the other), and every POST is bounded
 * by `BROWSER_LIVE_INPUT_TIMEOUT_MS` so a stuck one never freezes a lane.
 */

import {
  BROWSER_LIVE_INPUT_TIMEOUT_MS,
  type BrowserLiveInputAnswer,
  type BrowserLiveInputRequest,
} from "@houston/wire-types";
import type { Clock } from "../../ports";
import { BrowserLiveInputTimeout } from "./live-failure";

/** Pause before the next POST on a lane whose last one got no usable answer. */
export const BROWSER_LIVE_INPUT_RETRY_MS = [
  500, 1000, 2000, 4000, 8000,
] as const;

export interface InputLane {
  busy: boolean;
  timer: number | null;
  failures: number;
  /** The frame ack the POST in flight carries. */
  ack: number | null;
}

export const inputLane = (): InputLane => ({
  busy: false,
  timer: null,
  failures: 0,
  ack: null,
});

/** Arms `lane`'s next pause (growing with its failures) then runs `next`. */
export function backOff(lane: InputLane, clock: Clock, next: () => void): void {
  const steps = BROWSER_LIVE_INPUT_RETRY_MS;
  const pause = steps[Math.min(lane.failures, steps.length - 1)];
  lane.failures += 1;
  lane.timer = clock.setTimeout(() => {
    lane.timer = null;
    next();
  }, pause);
}

export function clearLane(lane: InputLane, clock: Clock): void {
  if (lane.timer !== null) clock.clearTimeout(lane.timer);
  lane.timer = null;
}

/**
 * `post(request)`, rejected with {@link BrowserLiveInputTimeout} when it takes
 * longer than `BROWSER_LIVE_INPUT_TIMEOUT_MS`. A late answer is dropped: the
 * retry carries the same batch seq, so the runtime applies it once either way.
 */
export function timedPost(
  post: (request: BrowserLiveInputRequest) => Promise<BrowserLiveInputAnswer>,
  clock: Clock,
  request: BrowserLiveInputRequest,
): Promise<BrowserLiveInputAnswer> {
  return new Promise((resolve, reject) => {
    const timer = clock.setTimeout(
      () => reject(new BrowserLiveInputTimeout()),
      BROWSER_LIVE_INPUT_TIMEOUT_MS,
    );
    post(request).then(
      (answer) => {
        clock.clearTimeout(timer);
        resolve(answer);
      },
      (err: unknown) => {
        clock.clearTimeout(timer);
        reject(err);
      },
    );
  });
}
