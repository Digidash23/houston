/**
 * One pass at a time. A request while a pass runs joins it and schedules
 * exactly one more pass after it (the tree may have changed mid-pass), as
 * long as `mayRerun` still allows it.
 */
export class CoalescedRun {
  private running: Promise<void> | undefined;
  private rerun = false;

  constructor(
    private readonly pass: () => Promise<void>,
    private readonly mayRerun: () => boolean,
  ) {}

  /** The pass in flight, if any. */
  get inFlight(): Promise<void> | undefined {
    return this.running;
  }

  /** Drop a scheduled extra pass (the work it would do is moot). */
  cancelRerun(): void {
    this.rerun = false;
  }

  request(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        await this.pass();
      } while (this.rerun && this.mayRerun());
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
}
