// `.ts` extensions so the node test runner can import this module directly.
import type { ScriptLine } from "./script-types.ts";

/**
 * The manager lines already on screen when the conversation opens: every one
 * before the manager's latest turn. A reload shows its history at once and
 * says only the latest turn again, the way a chat reopens.
 */
export function openingRevealed(lines: readonly ScriptLine[]): Set<string> {
  const lastReceipt = lines.findLastIndex((line) => line.kind === "receipt");
  const revealed = new Set<string>();
  lines.forEach((line, index) => {
    if (line.kind === "manager" && index < lastReceipt) revealed.add(line.key);
  });
  return revealed;
}

/** The first manager line still to say, or -1 when everything is said. A
 *  receipt is the person's own answer and is never typed out. */
export function nextUnrevealed(
  lines: readonly ScriptLine[],
  revealed: ReadonlySet<string>,
): number {
  return lines.findIndex(
    (line) => line.kind === "manager" && !revealed.has(line.key),
  );
}

/**
 * The growing text a message is typed out as, one word at a time: each frame
 * is a prefix of `text`, the last one the whole of it.
 */
export function revealFrames(text: string): string[] {
  const words = text.match(/\S+\s*/g) ?? [text];
  const frames: string[] = [];
  let shown = "";
  for (const word of words) {
    shown += word;
    frames.push(shown.trimEnd());
  }
  if (frames.at(-1) !== text) frames.push(text);
  return frames;
}
