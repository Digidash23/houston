/**
 * A turn's FIRST RESPONSE: what the person who sent a message waited for. It
 * is the turn's first visible assistant text, or, when none ever came, how the
 * turn ended without one. Reported once per turn this client sent (never for
 * an observed turn), through {@link FeedOutput.firstResponse}.
 *
 * Pairing is by construction: the clock belongs to ONE streamTurn call and is
 * only ever fed by that turn's own folded frames, so another conversation's
 * output, or another writer's turn in the same conversation, can never answer
 * it. "Own" is the sink's turn identity (`turn-identity.ts`), so the clock
 * shares its one accepted race: a running sync adopted after an accepted send
 * whose echo never arrived. There is no cut-off for a slow answer below {@link
 * FIRST_RESPONSE_TIMEOUT_MS}; past it the turn reports `timeout` (censored)
 * rather than vanishing.
 */

export type FirstResponseOutcome =
  /** The turn's first visible assistant text arrived. */
  | "first_text"
  /** The turn finished cleanly without any assistant text (tools only, a question card). */
  | "no_text"
  /** The turn failed, or the message never reached the engine. */
  | "error"
  /** The person stopped the turn before any text. */
  | "cancelled"
  /** The engine restarted under the turn before any text. */
  | "interrupted"
  /** Nothing of the above within {@link FIRST_RESPONSE_TIMEOUT_MS}. */
  | "timeout";

export interface FirstResponse {
  outcome: FirstResponseOutcome;
  /**
   * Epoch ms this client dispatched the turn: when the send left for the
   * engine, after any client-side hold (a queued send counts from its flush).
   */
  sentAt: number;
  /** Epoch ms the outcome became known (for `first_text`, when the text was pushed). */
  at: number;
  /** The turn's wire id, when it was adopted by then (absent on legacy servers). */
  turnId?: string;
}

/**
 * How long a turn may go without any outcome before it reports `timeout`. Ten
 * minutes, the same ceiling the gateway's latency ingest clamps to, so a
 * censored span means the same thing on both sides.
 */
export const FIRST_RESPONSE_TIMEOUT_MS = 600_000;

/** One turn's first-response clock: started at dispatch, reports exactly once. */
export class FirstResponseClock {
  readonly sentAt: number;
  private done = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly report: (response: FirstResponse) => void,
    timeoutMs: number = FIRST_RESPONSE_TIMEOUT_MS,
  ) {
    this.sentAt = Date.now();
    this.timer = setTimeout(() => this.resolve("timeout"), timeoutMs);
    // Never keep a process alive for a measurement (tests, shutdown).
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Report `outcome` unless the turn already reported one. */
  resolve(outcome: FirstResponseOutcome, turnId?: string): void {
    if (this.done) return;
    this.done = true;
    this.clearTimer();
    this.report({
      outcome,
      sentAt: this.sentAt,
      at: Date.now(),
      ...(turnId === undefined ? {} : { turnId }),
    });
  }

  /**
   * The stream went away with no outcome (client teardown: logout, a mode
   * change): report nothing, since the client that waited is gone.
   */
  dispose(): void {
    this.done = true;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** Whether a feed item is assistant text a person can see (not blank). */
export function isVisibleAssistantText(item: object): boolean {
  const it = item as { feed_type?: unknown; data?: unknown };
  return (
    (it.feed_type === "assistant_text_streaming" ||
      it.feed_type === "assistant_text") &&
    typeof it.data === "string" &&
    it.data.trim() !== ""
  );
}
