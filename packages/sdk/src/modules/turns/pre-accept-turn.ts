import type { WireFrame } from "@houston/runtime-client";
import { isTerminal } from "./send-hold-state";

/**
 * The running turn a turn sink saw while its send was still out, kept so the
 * send's 202 can claim it.
 *
 * A subscription that attaches after the engine already took our message
 * gets a `sync` naming the running turn, our `user` echo folded into it. Until
 * the 202 lands that turn may be another writer's, so the sink drops it (and
 * every frame stamped with its id) as foreign. When the 202 then names that
 * same turn, the kept frames were ours all along and the sink replays them in
 * stream order. Without this the turn rendered nothing until its terminal
 * frame, and a later turn's resync was adopted as ours.
 *
 * Only a 202 that names its turn can claim: without an id, a turn that ended
 * just before ours was admitted would be spliced in. Those servers keep the
 * old behavior.
 *
 * Nothing caps the kept frames: they are one turn's own output, the same data
 * the sink holds once that turn is ours, and they clear on the 202, a new sync,
 * a hold, a Stop, an ambiguous send or the sink's disposal. A cap would have to
 * settle a turn whose start was dropped, which history cannot always do. A
 * send whose POST never answers keeps them until the person stops or leaves,
 * the same hang that send has without them.
 *
 * A turn can also FAIL before its 202 with no running sync at all: a pooled
 * turn that fails during setup sends one `error` frame and nothing else
 * (H-003). Failure frames (`error` / `provider_error`) are therefore kept by
 * turn id, the kept turn's included, and survive a new sync (a failure is
 * final, a partial is not). The same 202 rule claims them. A bare `done` is
 * not kept that way: alone it carries none of the reply, which history holds
 * and the pre-settled poll adopts. Few turns end while one send is out, so
 * the last {@link MAX_FAILURES} are enough.
 */
export const MAX_FAILURES = 8;

const isFailure = (ev: WireFrame): boolean =>
  isTerminal(ev) && ev.type !== "done";

export class PreAcceptTurn {
  private frames: WireFrame[] | null = null;
  private turnId: string | undefined;
  private discardedTurnId: string | undefined;
  private readonly failures = new Map<string, WireFrame>();

  /** A running sync the sink dropped: the kept turn starts over from it. */
  keepSync(ev: WireFrame & { type: "sync" }): void {
    this.clear();
    if (!ev.data.turnId) return;
    this.turnId = ev.data.turnId;
    this.frames = [];
    this.append(ev);
  }

  /** A dropped frame: kept when it belongs to the kept turn or fails a turn. */
  keep(ev: WireFrame): void {
    if (ev.turnId === undefined) return;
    if (ev.turnId === this.turnId) this.append(ev);
    if (!isFailure(ev)) return;
    this.failures.delete(ev.turnId);
    this.failures.set(ev.turnId, ev);
    const oldest = this.failures.keys().next().value;
    if (this.failures.size > MAX_FAILURES && oldest !== undefined)
      this.failures.delete(oldest);
  }

  /** A held retry still needs to retain a sync that beats its 202. */
  keepWhileHeld(ev: WireFrame): void {
    if (ev.type === "sync") {
      this.clear();
      if (ev.data.running) this.keepSync(ev);
      return;
    }
    this.keep(ev);
  }

  /** A rejected candidate may still deliver frames after the 202. */
  shouldIgnore(ev: WireFrame): boolean {
    const turnId = ev.type === "sync" ? ev.data.turnId : ev.turnId;
    return turnId !== undefined && turnId === this.discardedTurnId;
  }

  /** Drop the kept running turn. Kept failures stay claimable. */
  clear(): void {
    this.frames = null;
    this.turnId = undefined;
  }

  /** Nothing kept can be claimed any more (stop, ambiguous send, teardown). */
  release(): void {
    this.clear();
    this.failures.clear();
  }

  /**
   * The kept frames when `turnId` names the kept turn, else its kept failure
   * frame. Clears replay storage.
   */
  claim(turnId: string | undefined): WireFrame[] {
    const candidateTurnId = this.turnId;
    const failure =
      turnId === undefined ? undefined : this.failures.get(turnId);
    const frames =
      turnId !== undefined && turnId === candidateTurnId
        ? (this.frames ?? [])
        : failure
          ? [failure]
          : [];
    const discardedTurnId =
      turnId !== undefined &&
      candidateTurnId !== undefined &&
      turnId !== candidateTurnId
        ? candidateTurnId
        : undefined;
    this.release();
    this.discardedTurnId = discardedTurnId;
    return frames;
  }

  private append(ev: WireFrame): void {
    this.frames?.push(ev);
  }
}
