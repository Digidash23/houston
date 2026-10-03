export * from "./stream-tuning";

/**
 * One live subscription per conversation, whoever opened it: a turn we sent
 * (`streamTurn`) or a passive observer (`observeConversation`). The registry
 * keeps the two from double-subscribing — duplicate streams would render
 * every frame twice.
 */
export interface ActiveStream {
  kind: "turn" | "observer";
  dispose: () => void;
  /** Last seen envelope seq — the observer→turn handoff cursor. */
  lastSeq?: number;
  /** A turn whose send is held behind another turn (`send-hold.ts`). */
  held?: boolean;
}

export const streamKey = (agentPath: string, sessionKey: string): string =>
  JSON.stringify([agentPath, sessionKey]);

/**
 * The set of live conversation streams for ONE owner (one {@link
 * import("../../sdk").HoustonSdk} instance, or the web adapter). It was a
 * package-level singleton — two owners sharing one map meant `disposeAll` on
 * one aborted the other's streams and same-key streams collided across owners.
 * Now each owner constructs its own instance and threads it explicitly into
 * {@link import("./turn-stream").streamTurn} / {@link
 * import("./observe-stream").observeConversation}; there is no hidden global.
 */
export class StreamRegistry {
  private readonly active = new Map<string, ActiveStream>();
  /** Keys with a turn send in flight — the observer→turn handoff double-send guard. */
  private readonly sending = new Set<string>();

  /** Wakers for callers waiting on an entry to leave its key. */
  private readonly leaving = new Set<() => void>();

  get(key: string): ActiveStream | undefined {
    return this.active.get(key);
  }
  set(key: string, entry: ActiveStream): void {
    this.active.set(key, entry);
    this.wakeLeaving();
  }
  delete(key: string): void {
    this.active.delete(key);
    this.wakeLeaving();
  }
  /** Remove `entry` only if it still owns `key` (a successor may have replaced it). */
  release(key: string, entry: ActiveStream): void {
    if (this.active.get(key) === entry) this.delete(key);
  }

  /**
   * Resolves once `entry` no longer owns `key` (settled, replaced or torn
   * down), or `signal` aborts. A send held behind an observed turn waits here
   * for that turn's observer to settle.
   */
  left(key: string, entry: ActiveStream, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        this.leaving.delete(check);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const check = () => {
        if (this.active.get(key) !== entry) done();
      };
      if (this.active.get(key) !== entry || signal.aborted) return resolve();
      this.leaving.add(check);
      signal.addEventListener("abort", done, { once: true });
    });
  }
  private wakeLeaving(): void {
    for (const check of [...this.leaving]) check();
  }

  /**
   * Claim the per-key send lock. Returns `true` if this caller now owns the
   * in-flight send, `false` if one is already running for `key` — closing the
   * observer→turn handoff window where two near-simultaneous `streamTurn` calls
   * both saw the observer as prior and both fired a real send. Release with
   * {@link endSend} once the turn stream is claimed (or the send failed).
   */
  beginSend(key: string): boolean {
    if (this.sending.has(key)) return false;
    this.sending.add(key);
    return true;
  }
  endSend(key: string): void {
    this.sending.delete(key);
  }
  /** Whether `key`'s send lock is still held (a teardown releases it). */
  isSending(key: string): boolean {
    return this.sending.has(key);
  }

  /**
   * Abort every live conversation stream (turns and observers alike). Wired to
   * the engine adapter's teardown seam (`EngineWebSocket.disconnect`, i.e. logout /
   * mode change) so an orphaned subscription never outlives its client. Sinks
   * are NOT settled: the UI is going away with the client.
   */
  disposeAll(): void {
    for (const s of this.active.values()) s.dispose();
    this.active.clear();
    this.sending.clear();
    this.wakeLeaving();
  }
}
