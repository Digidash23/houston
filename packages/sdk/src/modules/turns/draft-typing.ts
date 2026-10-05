/**
 * Whether a person is typing on, for the typing policy (`draft-prewarm.ts`):
 * one run per draft slot, kept while keystrokes come at most
 * {@link PREWARM_TYPING_GAP_MS} apart on one target.
 *
 * Package self-references only, like `draft-prewarm.ts`: the app's node:test
 * runner loads both through `@houston/sdk` subpaths.
 */

/** How long a person types without stopping before a prewarm starts. */
export const PREWARM_TYPING_MS = 1_500;

/** The longest pause between keystrokes that still counts as typing on. */
export const PREWARM_TYPING_GAP_MS = 1_000;

/** One draft slot's typing without a pause past the gap. */
export interface DraftTypingRun {
  target: string;
  startedAt: number;
  lastAt: number;
}

/** The typing runs of one policy's draft slots. */
export class DraftTypingRuns {
  private readonly runs = new Map<string, DraftTypingRun>();

  /** Extends the slot's run, or starts one after a pause past the gap, on
   *  another target, or when the clock went back (the elapsed time is then
   *  unknown, so nothing typed before counts). */
  keystroke(draftKey: string, target: string, now: number): DraftTypingRun {
    const run = this.runs.get(draftKey);
    const gap = run ? now - run.lastAt : -1;
    if (run?.target === target && gap >= 0 && gap <= PREWARM_TYPING_GAP_MS) {
      run.lastAt = now;
      return run;
    }
    const started: DraftTypingRun = { target, startedAt: now, lastAt: now };
    this.runs.set(draftKey, started);
    return started;
  }

  /** The slot's text emptied: its next keystroke starts a run. */
  end(draftKey: string): void {
    this.runs.delete(draftKey);
  }

  entries(): [string, DraftTypingRun][] {
    return [...this.runs].map(([key, run]) => [key, { ...run }]);
  }

  /** Takes over runs for every slot this instance has not typed in. */
  adopt(entries: readonly [string, DraftTypingRun][]): void {
    for (const [key, run] of entries)
      if (!this.runs.has(key)) this.runs.set(key, { ...run });
  }
}

/** The hold a prewarm answer reports; none for a skip or a shape it is not. */
export function holdOf(answer: unknown): number {
  const holdMs =
    answer && typeof answer === "object"
      ? (answer as { holdMs?: unknown }).holdMs
      : undefined;
  return typeof holdMs === "number" && holdMs > 0 ? holdMs : 0;
}
