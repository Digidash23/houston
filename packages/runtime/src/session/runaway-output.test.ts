import { expect, test } from "vitest";
import {
  createRunawayDetector,
  isRepetitionLoop,
  LOOP_WINDOW_CHARS,
} from "./runaway-output";

/**
 * The loop detector cuts a reply that degenerated into a short repeating unit.
 * The loops below are the four runaway replies from the 2026-10-03 staging
 * load test (RL2, model space-bunny-free), rebuilt from their repeating units;
 * the legit samples are the content shapes most likely to look repetitive.
 */

const repeat = (unit: string, chars: number) =>
  unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);

const prose = (chars: number) => {
  const words =
    "the ceramics workshop opens on saturday mornings with clay wheels glaze tables and a kiln for twelve students who book a seat online or at the market stall near the bakery".split(
      " ",
    );
  let out = "";
  for (let i = 0; out.length < chars; i++)
    out += `${words[(i * 7) % words.length]}${i % 13 === 12 ? ".\n" : " "}`;
  return out.slice(0, chars);
};

test("the staging runaway loops are loops", () => {
  // "SymbolSymbol…", "AnchorAnchor…", "LetterLetter…", " 묶 묶…".
  for (const unit of ["Symbol", "Anchor", "Letter", " 묶"])
    expect(isRepetitionLoop(repeat(unit, LOOP_WINDOW_CHARS))).toBe(true);
  // "@\t@\t…" with NULs scattered through it, which breaks strict periodicity.
  let noisy = "";
  for (let i = 0; noisy.length < LOOP_WINDOW_CHARS; i++)
    noisy += i % 7 === 3 ? "\u0000@\t" : "@\t";
  expect(isRepetitionLoop(noisy.slice(0, LOOP_WINDOW_CHARS))).toBe(true);
});

test("legit long output is not a loop", () => {
  expect(isRepetitionLoop(prose(LOOP_WINDOW_CHARS))).toBe(false);
  const table = `| Week | Action | Budget |\n|---|---|---|\n${Array.from(
    { length: 200 },
    (_, i) =>
      `| ${i + 1} | Post ${i % 5} flyers at stall ${i % 9} | ${i * 7} € |`,
  ).join("\n")}`;
  expect(isRepetitionLoop(table.slice(-LOOP_WINDOW_CHARS))).toBe(false);
  const csv = Array.from(
    { length: 600 },
    (_, i) => `${i},${(i * 7) % 13},${(i * 31) % 101}`,
  ).join("\n");
  expect(isRepetitionLoop(csv.slice(-LOOP_WINDOW_CHARS))).toBe(false);
});

test("a window shorter than the judged size is never a loop", () => {
  expect(isRepetitionLoop(repeat("Symbol", LOOP_WINDOW_CHARS - 1))).toBe(false);
});

test("the detector trips once a stream's window fills with a loop", () => {
  const detector = createRunawayDetector();
  const reply = prose(1000) + repeat("Symbol", 8000);
  let trippedAt: number | undefined;
  for (let i = 0; i < reply.length; i += 40) {
    if (detector.feed("text", reply.slice(i, i + 40))) {
      trippedAt = i + 40;
      break;
    }
  }
  // The loop starts at 1000 and fills a whole window by 5096; the next
  // judgement after that is at most 512 characters later.
  expect(trippedAt).toBeGreaterThanOrEqual(1000 + LOOP_WINDOW_CHARS);
  expect(trippedAt).toBeLessThanOrEqual(1000 + LOOP_WINDOW_CHARS + 512);
});

test("text and thinking are judged apart, and reset forgets both", () => {
  const detector = createRunawayDetector();
  // Interleaved with prose thinking, the text loop still fills its own window
  // (one shared buffer would hold half prose and never trip).
  const thinking = prose(6000);
  let tripped = false;
  for (let i = 0; i < 50 && !tripped; i++) {
    expect(
      detector.feed("thinking", thinking.slice(i * 120, i * 120 + 120)),
    ).toBe(false);
    tripped = detector.feed("text", repeat("Anchor", 120));
  }
  expect(tripped).toBe(true);
  // After a reset the loop must fill a whole window again.
  detector.reset();
  expect(detector.feed("text", repeat("Anchor", 4000))).toBe(false);
  expect(detector.feed("text", repeat("Anchor", 600))).toBe(true);
});

test("a long legit reply streamed in small deltas never trips", () => {
  const detector = createRunawayDetector();
  const reply = prose(60_000);
  for (let i = 0; i < reply.length; i += 17)
    expect(detector.feed("text", reply.slice(i, i + 17))).toBe(false);
});
