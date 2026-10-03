import type { WireFrame } from "@houston/runtime-client";
import { TurnEndCounter } from "./turn-end-counter";

const isTerminal = (
  ev: WireFrame,
): ev is Extract<WireFrame, { type: "done" | "error" | "provider_error" }> =>
  ev.type === "done" || ev.type === "error" || ev.type === "provider_error";

/**
 * The turn sink's view of a send held behind another turn (`send-hold.ts`).
 *
 * While held, every frame belongs to the running turn: the sink folds and
 * settles nothing, and counts that turn's end as the re-send trigger. Once a
 * send was held, the stream carried another turn while ours had no id, so
 * only our own nonce echo binds our turn. The sink never adopts a turn id it
 * saw before our send was accepted, and never adopts a stray terminal frame. The pool's 202
 * carries no turn id, and the previous turn's late `done` would otherwise
 * settle ours with its empty reply. A turn that fails before echoing is left
 * to the pre-settled poll, which settles only on our own persisted reply.
 */
export class SendHoldState {
  private on = false;
  private was = false;
  private readonly seen = new Set<string>();
  readonly ends = new TurnEndCounter();

  get holding(): boolean {
    return this.on;
  }
  hold(): void {
    this.on = true;
    this.was = true;
  }
  release(): void {
    this.on = false;
  }

  /**
   * Note a frame: count other turns' ends, and remember the turn ids seen
   * before our send was accepted (none of them can be ours).
   */
  note(ev: WireFrame, mine: string | undefined, accepted: boolean): void {
    if (isTerminal(ev) && ev.turnId && ev.turnId !== mine) this.ends.bump();
    if (mine !== undefined || accepted) return;
    const id = ev.type === "sync" ? ev.data.turnId : ev.turnId;
    if (id) this.seen.add(id);
  }

  /** Whether an unbound sink may adopt a stamped terminal frame's turn. */
  mayAdoptTerminal(): boolean {
    return !this.was;
  }
  /** Whether an unbound sink may adopt a running sync's turn. */
  mayAdoptRunning(turnId: string | undefined): boolean {
    return !(this.was && turnId !== undefined && this.seen.has(turnId));
  }
}
