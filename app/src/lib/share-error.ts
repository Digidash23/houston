import { classifyMoveRePost, isMoveRefusalCode } from "@houston/sdk";
import { engineErrorCode } from "./engine-error-code.ts";

/**
 * {@link engineErrorCode}, plus the ENGLISH SENTENCE as a last resort — the
 * share flow's own concession, kept here and nowhere else.
 *
 * The C8 gateway predates the `{error, code}` shape for some rejections and
 * answers them with a bare `{error: "<sentence>"}`. The share flow's step
 * machine renders a sentence it does not recognize as a generic failure rather
 * than classifying it, so falling back to it degrades gracefully. Anywhere
 * else, matching a code against an English sentence is a bug waiting for the
 * first reword, so `engineErrorCode` has no such fallback.
 */
export function shareErrorCode(err: unknown): string | undefined {
  const code = engineErrorCode(err);
  if (code !== undefined) return code;
  const bodyError = (err as { body?: { error?: unknown } } | null | undefined)
    ?.body?.error;
  return typeof bodyError === "string" ? bodyError : undefined;
}

/**
 * True for a gateway error the share flow renders INLINE (a `MoveFailedStep` or
 * an `InviteBadge`): an expected, user-actionable business state, NOT a Houston
 * bug. That is every C8 move refusal the SDK classifies (`isMoveRefusalCode`)
 * plus the invite `already_member`. `call()` silences these (no red bug toast,
 * no Sentry) so the inline surface is the only one; every other failure keeps
 * the generic toast + report.
 */
export function isExpectedShareError(err: unknown): boolean {
  const code = shareErrorCode(err);
  return isMoveRefusalCode(code) || code === "already_member";
}

/**
 * What a move wire keeps out of Sentry: every expected share state, plus every
 * answer the SDK classifies for a re-sent move (`move_in_progress`, and
 * `agent_moved` / `agent_not_found`, the agent already moved or gone).
 */
export function isExpectedMoveAnswer(err: unknown): boolean {
  return (
    isExpectedShareError(err) ||
    classifyMoveRePost(shareErrorCode(err)).kind !== "rejected"
  );
}
