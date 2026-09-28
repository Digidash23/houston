/**
 * A new mission's first send asks the runtime that runs the turn to title the
 * mission's card after the reply (no second request, no second sandbox).
 * `fallback` is the title the card was created with (written over only while
 * the card still shows it, so a user rename wins); `text` is the user's own
 * words to title.
 */
export interface MissionTitleRequest {
  fallback: string;
  text: string;
}

/**
 * Normalize an untrusted wire value; anything malformed means "no title", never
 * a refused turn. Shared by every hop that forwards or reads it.
 */
export function parseMissionTitle(
  value: unknown,
): MissionTitleRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { fallback, text } = value as Record<string, unknown>;
  if (typeof fallback !== "string" || typeof text !== "string")
    return undefined;
  if (!fallback.trim() || !text.trim()) return undefined;
  return { fallback, text };
}
