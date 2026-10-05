import type { WireFrame } from "@houston/runtime-client";

// Far above any turn's frames before its 202; only a pathological wait (a held
// send behind a very long turn) reaches it, and that turn then settles from history.
export const PRE_ACCEPT_MAX_FRAMES = 10_000;
export const PRE_ACCEPT_MAX_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

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
 */
export class PreAcceptTurn {
  private frames: WireFrame[] | null = null;
  private turnId: string | undefined;
  private discardedTurnId: string | undefined;
  private bytes = 0;
  /** The kept turn outgrew the cap: its replay would be a suffix, not a turn. */
  private overflowed = false;

  /** A running sync the sink dropped: the kept turn starts over from it. */
  keepSync(ev: WireFrame & { type: "sync" }): void {
    this.clear();
    if (!ev.data.turnId) return;
    this.turnId = ev.data.turnId;
    this.frames = [];
    this.append(ev);
  }

  /** A dropped frame: kept only when it belongs to the kept turn. */
  keep(ev: WireFrame): void {
    if (ev.turnId === this.turnId) this.append(ev);
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

  clear(): void {
    this.frames = null;
    this.turnId = undefined;
    this.bytes = 0;
    this.overflowed = false;
  }

  /**
   * The kept frames when `turnId` names the kept turn, and whether that turn's
   * beginning was dropped at the cap (`lostPrefix`: the caller must not build
   * the reply from later frames). Clears replay storage.
   */
  claim(turnId: string | undefined): {
    frames: WireFrame[];
    lostPrefix: boolean;
  } {
    const candidateTurnId = this.turnId;
    const claimed = turnId !== undefined && turnId === candidateTurnId;
    const frames = claimed ? (this.frames ?? []) : [];
    const lostPrefix = claimed && this.overflowed;
    const discardedTurnId =
      turnId !== undefined &&
      candidateTurnId !== undefined &&
      turnId !== candidateTurnId
        ? candidateTurnId
        : undefined;
    this.clear();
    this.discardedTurnId = discardedTurnId;
    return { frames, lostPrefix };
  }

  private append(ev: WireFrame): void {
    if (this.frames === null) return;
    const bytes = encoder.encode(JSON.stringify(ev)).byteLength;
    if (
      this.frames.length >= PRE_ACCEPT_MAX_FRAMES ||
      this.bytes + bytes > PRE_ACCEPT_MAX_BYTES
    ) {
      this.frames = null;
      this.bytes = 0;
      this.overflowed = true;
      return;
    }
    this.frames.push(ev);
    this.bytes += bytes;
  }
}
