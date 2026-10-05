import { EngineError } from "@houston/runtime-client";
import {
  type ComputeRefusal,
  parseComputeRefusalText,
} from "@houston/wire-types";
import type { StreamTuning } from "./stream-tuning";

/**
 * A send the cloud's shared compute had no room for (`503 compute_busy`):
 * nothing ran, and the gateway never moves it to a standing pod. The SDK keeps
 * the turn thinking and re-sends the SAME request (same nonce, so a late
 * acceptance can never double it) until it is admitted.
 *
 * The numbers come from staging load tests (2026-10-02/03): of 11,129 sends
 * that queued for room, every one was admitted within 45 s, and the slowest
 * run (a provider stall that held sandboxes 1.5 to 6 minutes) put p50 at
 * about 20 s. Each refusal already comes after the gateway held the send for
 * its 60 s queue, so ten minutes outlasts the slowest turnover of a full pool
 * seen so far with room to spare, and matches the first-response clock's own
 * ten-minute ceiling (`FIRST_RESPONSE_TIMEOUT_MS`): no busy send waits past
 * the point its turn already reports a timeout.
 */
export const SEND_BUSY_WAIT_MS = 10 * 60_000;

/**
 * How long a busy send waits before the VM says so (`sendWaiting: "busy"`).
 * At the cap, nine in ten turns showed their first text within 13.4 s
 * (staging, 2026-10-03), so past 15 s the plain thinking line stops being the
 * honest one.
 */
export const SEND_BUSY_NOTICE_MS = 15_000;

/** The re-send pause when the refusal names none, and its bounds. */
const BUSY_RETRY_DEFAULT_MS = 3_000;
const BUSY_RETRY_MIN_MS = 1_000;
const BUSY_RETRY_MAX_MS = 30_000;

/**
 * Chat copy for a busy send that ran out of {@link SEND_BUSY_WAIT_MS}: the
 * default for surfaces without a dictionary, keyed by the `compute_busy`
 * notice.
 */
export const COMPUTE_BUSY_MESSAGE =
  "It's too busy right now to start your message. Send it again in a few minutes.";

/** The gateway's `compute_busy` refusal behind a failed send, or null. */
export function computeBusyRefusal(e: unknown): ComputeRefusal | null {
  if (!(e instanceof EngineError) || e.status !== 503) return null;
  const refusal = parseComputeRefusalText(e.body);
  return refusal?.code === "compute_busy" ? refusal : null;
}

/** Why a sent message is still waiting to start; only busy compute today. */
export type SendWaitReason = "busy";

/**
 * One send's busy budget: when it may re-send next, and when the wait has
 * grown long enough for the VM to say so. `dispose` once the send settles.
 */
export class SendBusyClock {
  private readonly budget: number;
  private readonly notice: number;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** `started`: when the message first went out (default: now). */
  constructor(
    tuning: StreamTuning | undefined,
    private readonly started: number = Date.now(),
  ) {
    this.budget = tuning?.sendBusyWaitMs ?? SEND_BUSY_WAIT_MS;
    this.notice = tuning?.sendBusyNoticeMs ?? SEND_BUSY_NOTICE_MS;
  }

  private get waited(): number {
    return Date.now() - this.started;
  }

  /** The budget is spent: the refusal stands. */
  get spent(): boolean {
    return this.waited >= this.budget;
  }

  /** What is left of the budget. */
  get left(): number {
    return Math.max(0, this.budget - this.waited);
  }

  /**
   * Call `onBusy` once the wait reaches the notice threshold, on a timer of
   * its own: a re-send the gateway holds in its queue must not delay it.
   * Arming again is a no-op.
   */
  armNotice(onBusy: () => void): void {
    if (this.noticeTimer !== undefined) return;
    this.noticeTimer = setTimeout(
      onBusy,
      Math.max(0, this.notice - this.waited),
    );
  }

  dispose(): void {
    clearTimeout(this.noticeTimer);
  }

  /** The pause before the next re-send: the server's hint, bounded. */
  pauseFor(refusal: ComputeRefusal): number {
    const hint = refusal.retryAfterMs ?? BUSY_RETRY_DEFAULT_MS;
    const pause = Math.min(
      Math.max(hint, BUSY_RETRY_MIN_MS),
      BUSY_RETRY_MAX_MS,
    );
    return Math.min(pause, this.left);
  }
}
