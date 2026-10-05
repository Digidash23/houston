import type { WireFrame } from "@houston/runtime-client";

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
 * a hold or the sink's disposal. A cap would have to settle a turn whose start
 * was dropped, which history cannot always do.
 */
export class PreAcceptTurn {
  private frames: WireFrame[] | null = null;
  private turnId: string | undefined;
  private discardedTurnId: string | undefined;

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
  }

  /** The kept frames when `turnId` names the kept turn. Clears replay storage. */
  claim(turnId: string | undefined): WireFrame[] {
    const candidateTurnId = this.turnId;
    const frames =
      turnId !== undefined && turnId === candidateTurnId
        ? (this.frames ?? [])
        : [];
    const discardedTurnId =
      turnId !== undefined &&
      candidateTurnId !== undefined &&
      turnId !== candidateTurnId
        ? candidateTurnId
        : undefined;
    this.clear();
    this.discardedTurnId = discardedTurnId;
    return frames;
  }

  private append(ev: WireFrame): void {
    this.frames?.push(ev);
  }
}
