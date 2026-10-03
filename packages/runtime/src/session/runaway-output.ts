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
 * Text inside a markdown code block is never judged: output a person asked
 * for that repeats by design (ASCII art, a zero-filled array, rows of one CSV
 * line) belongs in one, while the staging loops all ran in plain prose. A
 * fence is a line of 3 or more backticks or tildes, after any indentation or
 * blockquote markers (a block nested in a list or a quote counts); it closes
 * on a line of the same character, at least as long, with nothing after it.
 * A backtick run mid-sentence is no fence, nor is any line longer than
 * `FENCE_LINE_MAX`: a looping line never ends, and must still be judged.
 */
const FENCE_LINE = /^[ \t>]*(`{3,}|~{3,})(.*)$/;
/** A line that may still become a fence line as more of it streams. */
const FENCE_PREFIX = /^[ \t>]*(?:`*|~*|`{3,}.*|~{3,}.*)$/s;
const FENCE_LINE_MAX = 512;

interface Fence {
  char: string;
  run: number;
}

/** The fence `line` opens (when `open` is null) or whether it closes `open`. */
function fenceAt(line: string, open: Fence | null): Fence | boolean {
  const match = FENCE_LINE.exec(line);
  if (!match) return false;
  const [, run = "", rest = ""] = match;
  const char = run.charAt(0);
  if (open)
    return char === open.char && run.length >= open.run && rest.trim() === "";
  // A backtick opener's info string holds no backtick (that line is inline code).
  if (char === "`" && rest.includes("`")) return false;
  return { char, run: run.length };
}

interface Stream {
  /** The judged text since the last fence, at most a window of it. */
  tail: string;
  unjudged: number;
  fence: Fence | null;
  /**
   * The current line while it may still be a fence line: held back from
   * judgement until the line ends or proves to be text.
   */
  line: string | null;
}

export function createRunawayDetector(): RunawayDetector {
  const streams = new Map<StreamedKind, Stream>();
  const judged = (stream: Stream, text: string) => {
    if (stream.fence || !text) return;
    stream.tail = (stream.tail + text).slice(-LOOP_WINDOW_CHARS);
    stream.unjudged += text.length;
  };
  return {
    feed(kind, delta) {
      let stream = streams.get(kind);
      if (!stream) {
        stream = { tail: "", unjudged: 0, fence: null, line: "" };
        streams.set(kind, stream);
      }
      let from = 0;
      while (from < delta.length) {
        // CR, LF and CRLF all end a line; a CRLF split across deltas only
        // adds an empty line, which is never a fence.
        let end = from;
        while (end < delta.length && delta[end] !== "\n" && delta[end] !== "\r")
          end++;
        const text = delta.slice(from, end);
        const ended = end < delta.length;
        from = end + 1;
        if (stream.line === null) judged(stream, text);
        else {
          stream.line += text;
          if (
            stream.line.length > FENCE_LINE_MAX ||
            !FENCE_PREFIX.test(stream.line)
          ) {
            judged(stream, stream.line);
            stream.line = null;
          }
        }
        if (!ended) break;
        const at =
          stream.line === null ? false : fenceAt(stream.line, stream.fence);
        if (at === false) judged(stream, `${stream.line ?? ""}\n`);
        else {
          stream.fence = at === true ? null : at;
          stream.tail = "";
          stream.unjudged = 0;
        }
        stream.line = "";
      }
      if (stream.fence || stream.unjudged < JUDGE_EVERY_CHARS) return false;
      stream.unjudged = 0;
      return isRepetitionLoop(stream.tail);
    },
    reset() {
      streams.clear();
    },
  };
}
