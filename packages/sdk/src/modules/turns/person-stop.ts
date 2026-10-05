/**
 * The person's Stop of a message the engine has not accepted. The send ends
 * at once; the turn settles as stopped only once every engine cancel the
 * person sent answered (each Stop sends one), however long that takes.
 * Settling first would let a message queued behind the turn go out, and a
 * cancel still out would then stop it instead. Every caller calls its
 * `finish` in a `finally`, so a cancel that fails settles the turn too.
 */
export class PersonStop {
  /** Cancels still out. */
  private pending = 0;
  private settle: (() => void) | undefined;
  private closed = false;
  private resolveSettled: () => void = () => {};
  private readonly settled = new Promise<void>((r) => {
    this.resolveSettled = r;
  });

  /**
   * One Stop's cancel: the `finish` its caller calls once that cancel
   * answered. Joinable until the turn has settled, never just answered:
   * null only once nothing more can reach it.
   */
  join(): (() => void) | null {
    if (this.closed) return null;
    this.pending++;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.pending--;
      this.maybeSettle();
    };
  }

  /**
   * Run `settle` once no cancel is out: synchronously inside the last
   * `finish` (or now, if they all answered already), so no Stop can slip in
   * between the answer and the settle. Resolves after it ran.
   */
  settleWith(settle: () => void): Promise<void> {
    this.settle = settle;
    this.maybeSettle();
    return this.settled;
  }

  private maybeSettle(): void {
    if (this.closed || this.pending > 0 || !this.settle) return;
    this.closed = true;
    this.settle();
    this.resolveSettled();
  }
}
