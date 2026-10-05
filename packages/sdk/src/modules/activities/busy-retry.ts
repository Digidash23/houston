/**
 * Re-issue a board-card write the gateway or host refused with "not now, ask
 * again", so a card is never dropped to a busy or waking agent.
 *
 * Two refusals qualify, each on its own schedule:
 *
 *  - `503 agent busy; retry in a moment` + `Retry-After: 2`: only the gateway
 *    that applies board-card writes itself (the per-turn pool path) answers
 *    it, while the agent is mid-operation. Honors `Retry-After`, bounded at
 *    {@link WRITE_RETRY_BUDGET_MS} of pauses. No standing pod ever sends it.
 *  - the waking pairs ({@link isWakingAnswer}): the pod is not there yet
 *    (PRODUCT-1736). Only a create the caller marks `retryWhileWaking` walks
 *    {@link WAKING_CREATE_RETRY_MS}, the ladder the app ran on the optimistic
 *    mission row before the SDK owned it, and so does a first-day start
 *    (`../agents/first-day.ts`), which the host makes idempotent; every other
 *    write surfaces a waking refusal at once, as it always did.
 *
 * Every other failure surfaces unchanged on the first attempt. Safe to repeat:
 * create is idempotent by the client-supplied id (the host answers the stored
 * row on a same create) and an update re-applies the same fields. An exhausted
 * schedule rethrows the LAST refusal so the caller owns the one report. Pauses
 * count, not wall time: a waking attempt already rides the gateway's own wake
 * hold, and counting that hold would leave no retry at all.
 */

import { parseComputeRefusalText } from "@houston/wire-types";
import type { Clock } from "../../ports";
import { SdkHttpError } from "../http";
import { isWakingAnswer } from "../waking-answer";

/** Total pause across one write's busy retries. */
export const WRITE_RETRY_BUDGET_MS = 20_000;
/**
 * Pauses before the second, third and fourth attempt of a create that rides
 * out a pod wake. Each attempt itself rides the gateway's wake hold, so the
 * ladder only bridges one hold giving up and the pod answering.
 */
export const WAKING_CREATE_RETRY_MS: readonly number[] = [
  5_000, 15_000, 30_000,
];
/** The pause when a refusal carries no readable `Retry-After`. */
const DEFAULT_PAUSE_MS = 2_000;
/** A `Retry-After: 0` must not spin the ladder without ever spending budget. */
const MIN_PAUSE_MS = 500;

const AGENT_BUSY_503 = "agent busy; retry in a moment";

/** The JSON `error` reason of a raw refusal body, or null. */
function jsonReasonOf(text: string): string | null {
  if (!text.startsWith("{")) return null;
  try {
    const reason = (JSON.parse(text) as { error?: unknown } | null)?.error;
    return typeof reason === "string" ? reason : null;
  } catch {
    return null;
  }
}

/**
 * The gateway's busy refusal, JSON or plain text. One that carries the
 * `compute_busy` code was already sent again, within its budget, by
 * `httpRequest` itself: it surfaces here spent.
 */
export function isAgentBusyRefusal(e: unknown): e is SdkHttpError {
  if (!(e instanceof SdkHttpError) || e.status !== 503) return false;
  const text = e.message.trim();
  if (parseComputeRefusalText(text)) return false;
  return (jsonReasonOf(text) ?? text) === AGENT_BUSY_503;
}

/** A waking pair in gateway JSON, read exactly as the app's classifier did. */
export function isWakingWriteRefusal(e: unknown): e is SdkHttpError {
  if (!(e instanceof SdkHttpError)) return false;
  const reason = jsonReasonOf(e.message.trim());
  return reason !== null && isWakingAnswer(e.status, reason);
}

/** Which refusals a write rides out beyond the busy one. */
export interface WriteRetryPolicy {
  /** Pauses for waking refusals, one per retry; empty = surface at once. */
  wakingLadderMs: readonly number[];
}

export async function retryWriteWhileRefused<T>(
  clock: Clock,
  write: () => Promise<T>,
  policy: WriteRetryPolicy = { wakingLadderMs: [] },
): Promise<T> {
  let busyPaused = 0;
  let wakingRung = 0;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => clock.setTimeout(resolve, ms));
  for (;;) {
    try {
      return await write();
    } catch (e) {
      if (isAgentBusyRefusal(e)) {
        const pause = Math.max(
          MIN_PAUSE_MS,
          e.retryAfterMs ?? DEFAULT_PAUSE_MS,
        );
        if (busyPaused + pause > WRITE_RETRY_BUDGET_MS) throw e;
        busyPaused += pause;
        await sleep(pause);
        continue;
      }
      const rung = isWakingWriteRefusal(e)
        ? policy.wakingLadderMs[wakingRung]
        : undefined;
      if (rung === undefined) throw e;
      wakingRung += 1;
      await sleep(rung);
    }
  }
}
