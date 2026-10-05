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
 */
export class PreAcceptTurn {
  private frames: WireFrame[] | null = null;

  /** A running sync the sink dropped: the kept turn starts over from it. */
  keepSync(ev: WireFrame & { type: "sync" }): void {
    this.frames = ev.data.turnId ? [ev] : null;
  }

  /** A dropped frame: kept only when it belongs to the kept turn. */
  keep(ev: WireFrame): void {
    const first = this.frames?.[0];
    if (first?.type === "sync" && ev.turnId === first.data.turnId)
      this.frames?.push(ev);
  }

  clear(): void {
    this.frames = null;
  }

  /** The kept frames when `turnId` names the kept turn, else none. Clears. */
  claim(turnId: string | undefined): WireFrame[] {
    const frames = this.frames ?? [];
    this.frames = null;
    const first = frames[0];
    return turnId && first?.type === "sync" && first.data.turnId === turnId
      ? frames
      : [];
  }
}
