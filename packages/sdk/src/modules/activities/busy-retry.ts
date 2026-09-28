/**
 * Re-issue a board-card write the gateway or host refused with "not now, ask
 * again", so a card is never dropped to a busy or waking agent.
 *
 * Two refusals qualify. The gateway applies board-card writes itself and
 * answers `503 agent busy; retry in a moment` + `Retry-After: 2` while the
 * agent is mid-operation; and the waking pairs ({@link isWakingAnswer}) mean
 * the pod is not there yet (PRODUCT-1736). Every other failure surfaces
 * unchanged on the first attempt.
 *
 * Safe to repeat: create is idempotent by the client-supplied id (the host
 * answers the stored row on a same create) and an update re-applies the same
 * fields. The ladder honors the server's `Retry-After` and gives up once the
 * pauses would exceed {@link WRITE_RETRY_BUDGET_MS}, rethrowing the LAST
 * refusal so the caller owns the one report. The budget counts pauses, not
 * wall time: a waking attempt already rides the gateway's own wake hold, and
 * counting that hold would leave no retry at all.
 */

import type { Clock } from "../../ports";
import { SdkHttpError } from "../http";
import { isWakingAnswer } from "../waking-answer";

/** Total pause across one write's retries. */
export const WRITE_RETRY_BUDGET_MS = 20_000;
/** The pause when a refusal carries no readable `Retry-After`. */
const DEFAULT_PAUSE_MS = 2_000;
/** A `Retry-After: 0` must not spin the ladder without ever spending budget. */
const MIN_PAUSE_MS = 500;

const AGENT_BUSY_503 = "agent busy; retry in a moment";

/** The gateway reason in a raw refusal body: JSON `error`, else the text. */
function reasonOf(body: string): string {
  const text = body.trim();
  if (!text.startsWith("{")) return text;
  try {
    const reason = (JSON.parse(text) as { error?: unknown } | null)?.error;
    return typeof reason === "string" ? reason : text;
  } catch {
    return text;
  }
}

/** A refusal the same write succeeds after: the agent busy, or its pod waking. */
export function isRetryableWriteRefusal(e: unknown): e is SdkHttpError {
  if (!(e instanceof SdkHttpError)) return false;
  const reason = reasonOf(e.message);
  return (
    (e.status === 503 && reason === AGENT_BUSY_503) ||
    isWakingAnswer(e.status, reason)
  );
}

export async function retryWriteWhileRefused<T>(
  clock: Clock,
  write: () => Promise<T>,
): Promise<T> {
  let paused = 0;
  for (;;) {
    try {
      return await write();
    } catch (e) {
      if (!isRetryableWriteRefusal(e)) throw e;
      const pause = Math.max(MIN_PAUSE_MS, e.retryAfterMs ?? DEFAULT_PAUSE_MS);
      if (paused + pause > WRITE_RETRY_BUDGET_MS) throw e;
      paused += pause;
      await new Promise<void>((resolve) => clock.setTimeout(resolve, pause));
    }
  }
}
