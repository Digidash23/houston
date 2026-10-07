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
 *
 * The report also carries the turn's FIRST ACTIVITY: the first visible item of
 * any kind (thinking, a tool call, or text). Text often waits for several tool
 * round trips while the chat already shows the turn working, so first activity
 * is the "is it alive" time and first text the "did it answer" time.
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
  /**
   * Epoch ms the turn's first visible item of any kind (thinking, a tool call,
   * or text) was pushed, at or before `at`. Absent when nothing visible came
   * before the outcome (a refused send, a silent timeout).
   */
  firstActivityAt?: number;
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
  private firstActivityAt: number | undefined;
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

  /**
   * The turn pushed a feed item: the first visible one stamps first activity,
   * and the first visible assistant text resolves `first_text`.
   */
  pushed(item: object, turnId?: string): void {
    if (this.done) return;
    if (this.firstActivityAt === undefined && isVisibleActivity(item))
      this.firstActivityAt = Date.now();
    if (isVisibleAssistantText(item)) this.resolve("first_text", turnId);
  }

  /** Report `outcome` unless the turn already reported one. */
  resolve(outcome: FirstResponseOutcome, turnId?: string): void {
    if (this.done) return;
    this.done = true;
    this.clearTimer();
    const at = this.firstActivityAt;
    this.report({
      outcome,
      sentAt: this.sentAt,
      at: Date.now(),
      ...(turnId === undefined ? {} : { turnId }),
      ...(at === undefined ? {} : { firstActivityAt: at }),
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

/**
 * Whether a feed item shows the person the turn is working: non-blank thinking,
 * a tool call, or visible assistant text.
 */
export function isVisibleActivity(item: object): boolean {
  const it = item as { feed_type?: unknown; data?: unknown };
  if (it.feed_type === "tool_call") return true;
  if (it.feed_type === "thinking_streaming" || it.feed_type === "thinking")
    return typeof it.data === "string" && it.data.trim() !== "";
  return isVisibleAssistantText(item);
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
