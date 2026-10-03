/**
 * Spots a model stuck in a repetition loop while it streams. A degenerate
 * generation repeats a short unit ("SymbolSymbol…", "@\t@\t…", " 묶 묶…") until
 * the provider's output limit, and some models allow 500k output tokens: on
 * staging (RL2, 2026-10-03) four such replies ran 112 to 217 s and 19k to 28k
 * tokens each, holding a sandbox the whole time.
 *
 * The test is how many distinct 4-character sequences the last
 * `LOOP_WINDOW_CHARS` of a text or thinking stream holds. A loop of a unit up
 * to a few dozen characters holds at most a few dozen; the four staging loops
 * measured 2 to 56, and each was caught within the reply's first 6.4k
 * characters, 4 to 48 s into replies that ran 112 to 217 s, while none of the
 * other 255 replies of the same run tripped. Real prose, code, tables and JSON hold
 * hundreds: the least varied 4 KiB window across the Houston and cloud repos
 * (3,806 files, 40 MB) held 278. Tool-call input is never judged, so a file
 * the model writes may repeat itself freely.
 */

/** Trailing characters judged together. */
export const LOOP_WINDOW_CHARS = 4096;
/** A window with this many distinct 4-character sequences or fewer is a loop. */
export const LOOP_MAX_DISTINCT = 64;
/** New characters between two judgements: a judgement walks the whole window. */
const JUDGE_EVERY_CHARS = 512;

export type StreamedKind = "text" | "thinking";

/** Whether `window` (a full one) is a short unit repeating. */
export function isRepetitionLoop(window: string): boolean {
  if (window.length < LOOP_WINDOW_CHARS) return false;
  const seen = new Set<string>();
  for (let i = 0; i + 4 <= window.length; i++) {
    seen.add(window.slice(i, i + 4));
    if (seen.size > LOOP_MAX_DISTINCT) return false;
  }
  return true;
}

export interface RunawayDetector {
  /** Feed one streamed delta; true once its stream is a repetition loop. */
  feed(kind: StreamedKind, delta: string): boolean;
  /** Forget both streams (a new model response begins). */
  reset(): void;
}

export function createRunawayDetector(): RunawayDetector {
  const tails = new Map<StreamedKind, { tail: string; unjudged: number }>();
  return {
    feed(kind, delta) {
      const stream = tails.get(kind) ?? { tail: "", unjudged: 0 };
      stream.tail = (stream.tail + delta).slice(-LOOP_WINDOW_CHARS);
      stream.unjudged += delta.length;
      tails.set(kind, stream);
      if (stream.unjudged < JUDGE_EVERY_CHARS) return false;
      stream.unjudged = 0;
      return isRepetitionLoop(stream.tail);
    },
    reset() {
      tails.clear();
    },
  };
}
