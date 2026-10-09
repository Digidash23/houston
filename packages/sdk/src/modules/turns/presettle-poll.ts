import type { PresettleVerdict } from "./settle-from-history";
import {
  PRESETTLED_GONE_MAX_POLL_MS,
  PRESETTLED_GONE_MS,
} from "./stream-tuning";

/**
 * What the pre-settled poll needs from its turn sink. `canArm`: the send was
 * accepted, no stream evidence arrived and no settle is underway. `check`:
 * one conclusive-only history settle. `gone`: the conversation stayed not
 * found for {@link PRESETTLED_GONE_MS}; the host settles the turn as lost.
 */
export interface PresettleHost {
  canArm(): boolean;
  check(): Promise<PresettleVerdict>;
  gone(): void;
}

/**
 * Arm the pre-settled poll once the send is ACCEPTED — the poll is the
 * backstop that settles a turn whose terminal frame we never received on the
 * stream. It used to also require a fresh idle sync, but that left a hole: a
 * turn that fails INSTANTLY (fail-before-execute — a disconnected local
 * model) has its terminal frame published and the replay buffer cleared
 * before our subscription attaches, and a flaky SSE hop can then deliver NO
 * frame at all — no sync, so the poll never armed and the turn spun until the
 * ~6-minute reconnect budget gave up. Arming on acceptance alone closes that:
 * the poll is CONCLUSIVE-ONLY (`presettleFromHistory` settles solely on a real
 * reply for our turnId, or a guard-accepted trailing reply), so a turn that is
 * genuinely still running finds no reply and simply re-arms — and a running
 * sync cancels the poll outright (`markRunning`), so a normal turn never
 * pays for it. Idempotent; disabled in observer mode (no `presettledPollMs`).
 */
export class PresettlePoll {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** When the reloads started answering "conversation not found" in a row. */
  private goneSince: number | undefined;
  /** The backed-off interval while history answers 404. */
  private delay: number | undefined;

  constructor(
    /** Absent disables the poll (observer mode). */
    private readonly ms: number | undefined,
    private readonly host: PresettleHost,
  ) {}

  /** Idempotent: arms once, only while the host allows it. */
  arm(): void {
    if (this.ms === undefined || this.timer !== undefined) return;
    if (!this.host.canArm()) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.fire();
    }, this.delay ?? this.ms);
  }

  /** Stream evidence: the poll stops, and so does the not-found clock. */
  cancel(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.goneSince = undefined;
    this.delay = undefined;
  }

  /**
   * Reload history and settle ONLY on conclusive proof the turn finished (a
   * reply for our turnId, or a legacy trailing reply the guard accepts). This
   * is the sole caller of the CONCLUSIVE-ONLY {@link presettleFromHistory} —
   * never the fall-through `settleFromHistory`, whose no-reply branch would
   * WRONGLY error a healthy slow turn (its history ends on our trailing user
   * message). Inconclusive re-arms the poll; any stream evidence in the interim
   * cancels it, and the reconnect budget still owns a genuinely lost stream.
   * A conversation that stays not found is bounded: the healthy stream would
   * otherwise keep the poll reading 404 until the person leaves (H-003).
   */
  private async fire(): Promise<void> {
    if (!this.host.canArm()) return;
    const verdict = await this.host.check();
    if (verdict === "settled") return;
    if (verdict === "gone") {
      this.goneSince ??= Date.now();
      if (Date.now() - this.goneSince >= PRESETTLED_GONE_MS) {
        if (this.host.canArm()) this.host.gone();
        return;
      }
      const last = this.delay ?? this.ms ?? PRESETTLED_GONE_MAX_POLL_MS;
      this.delay = Math.min(last * 2, PRESETTLED_GONE_MAX_POLL_MS);
    } else {
      this.goneSince = undefined;
      this.delay = undefined;
    }
    // Inconclusive: the turn hasn't proven it finished. Re-arm and keep the
    // stream as the authority (frames cancel the poll; the budget owns loss).
    this.arm();
  }
}
