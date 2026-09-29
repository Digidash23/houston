/**
 * A new mission's AI title, generated AFTER its first turn in the same runtime
 * that ran the turn (no second sandbox, no second client request). The send
 * names the fallback title the card was created with and the words to title;
 * the title is written only while the card still shows that fallback, so a
 * rename the user made in the meantime always wins.
 */
export {
  type MissionTitleRequest,
  parseMissionTitle,
} from "@houston/protocol";

import type { MissionTitleRequest } from "@houston/protocol";

/** Produce a raw title for an excerpt, on the turn's own provider/model. */
export type MissionTitleRunner = (
  excerpt: string,
  signal: AbortSignal,
) => Promise<string>;

/** The longest a title may take before the card keeps its fallback. */
export const MISSION_TITLE_TIMEOUT_MS = 10_000;

const EXCERPT_MAX = 2400;

/** A model reply trimmed to a card title: 6 words, 64 chars, no quotes. */
export function cleanMissionTitle(value: string | undefined): string | null {
  if (!value) return null;
  const firstLine = value.trim().split("\n")[0] ?? "";
  const normalized = firstLine
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replace(/^["'`]+|["'`.]+$/g, "")
    .trim();
  if (!normalized) return null;
  const words = normalized.split(" ").slice(0, 6).join(" ");
  return [...words].slice(0, 64).join("");
}

class MissionTitleTimeout extends Error {}

/** Why a title run produced nothing better than the fallback. */
export type MissionTitleMiss = "timeout" | "error" | "no_title";

/** A usable title, or the reason there is none. */
export type MissionTitleResult = { title: string } | { miss: MissionTitleMiss };

/**
 * Run the title within {@link MISSION_TITLE_TIMEOUT_MS}. Resolves the title to
 * write, or null when there is nothing better than the fallback. Never rejects:
 * a slow or failed title keeps the fallback, and the failure is reported
 * (console.error reaches Sentry; a timeout is a warning, nothing broke).
 */
export async function generateMissionTitle(
  conversationId: string,
  request: MissionTitleRequest,
  run: MissionTitleRunner,
  timeoutMs = MISSION_TITLE_TIMEOUT_MS,
): Promise<string | null> {
  const result = await runMissionTitle(conversationId, request, run, timeoutMs);
  return "title" in result ? result.title : null;
}

/** {@link generateMissionTitle}, naming why a run kept the fallback. */
export async function runMissionTitle(
  conversationId: string,
  request: MissionTitleRequest,
  run: MissionTitleRunner,
  timeoutMs = MISSION_TITLE_TIMEOUT_MS,
): Promise<MissionTitleResult> {
  const excerpt = request.text.trim().slice(0, EXCERPT_MAX);
  if (!excerpt) return { miss: "no_title" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Aborted when the cap trips, so a slow model call stops spending (and, in a
  // per-turn sandbox, stops holding the turn open) instead of running on.
  const abort = new AbortController();
  try {
    const raw = await Promise.race([
      run(excerpt, abort.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new MissionTitleTimeout()), timeoutMs);
      }),
    ]);
    const title = cleanMissionTitle(raw);
    return title && title !== request.fallback
      ? { title }
      : { miss: "no_title" };
  } catch (err) {
    if (err instanceof MissionTitleTimeout) {
      abort.abort();
      console.warn(
        `[mission-title] no title within ${timeoutMs} ms for ${conversationId}; keeping the fallback`,
      );
      return { miss: "timeout" };
    }
    console.error(
      `[mission-title] title failed for ${conversationId}; keeping the fallback:`,
      err instanceof Error ? err.message : String(err),
    );
    return { miss: "error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
