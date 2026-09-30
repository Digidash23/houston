/**
 * A deliberately conservative token count for text Houston sizes itself: a
 * routine chat's carried context and the replay a fresh routine session opens
 * with (routine-context.ts, routine-replay.ts).
 *
 * Four characters a token holds for English prose only. Digits, punctuation
 * and identifiers (logs, ids, JSON) run nearer two, and CJK and most other
 * non-Latin scripts nearer one. An undercount is the failure that matters
 * here: a replay sized by it lands past the carry line, and then every run
 * resets or overflows. So each class is charged at its dense end.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (let i = 0; i < text.length; i++)
    tokens += charTokens(text.charCodeAt(i));
  return Math.ceil(tokens);
}

/** One UTF-16 unit's share of a token. */
function charTokens(code: number): number {
  if (code >= 0x80) return 1;
  const letter =
    (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a);
  return letter || code === 0x20 ? 0.25 : 0.5;
}
