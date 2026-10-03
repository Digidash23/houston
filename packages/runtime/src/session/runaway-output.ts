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
 * (3,806 files, 40 MB) held 278. Tool-call input and code blocks are never
 * judged, so a file the model writes, or ASCII art it was asked for, may
 * repeat itself freely.
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

/**
 * A markdown code fence. Text inside one is never judged: output a person
 * asked for that repeats by design (ASCII art, a zero-filled array, rows of
 * one CSV line) belongs in a code block, while the staging loops all ran in
 * plain prose.
 */
const FENCE = "```";

interface Stream {
  /** The judged text since the last fence, at most a window of it. */
  tail: string;
  unjudged: number;
  inFence: boolean;
  /** The last characters seen, for a fence split across two deltas. */
  carry: string;
}

export function createRunawayDetector(): RunawayDetector {
  const streams = new Map<StreamedKind, Stream>();
  return {
    feed(kind, delta) {
      let stream = streams.get(kind);
      if (!stream) {
        stream = { tail: "", unjudged: 0, inFence: false, carry: "" };
        streams.set(kind, stream);
      }
      const scan = stream.carry + delta;
      // Past the last fence in this delta, or -1 for none.
      let after = -1;
      for (
        let at = scan.indexOf(FENCE);
        at !== -1;
        at = scan.indexOf(FENCE, at + FENCE.length)
      ) {
        stream.inFence = !stream.inFence;
        after = at + FENCE.length;
      }
      stream.carry = scan.slice(Math.max(after, scan.length - 2, 0));
      if (after !== -1) {
        stream.tail = "";
        stream.unjudged = 0;
      }
      if (stream.inFence) return false;
      const fresh = after === -1 ? delta : scan.slice(after);
      stream.tail = (stream.tail + fresh).slice(-LOOP_WINDOW_CHARS);
      stream.unjudged += fresh.length;
      if (stream.unjudged < JUDGE_EVERY_CHARS) return false;
      stream.unjudged = 0;
      return isRepetitionLoop(stream.tail);
    },
    reset() {
      streams.clear();
    },
  };
}
