/**
 * Re-run a write the gateway refused because the agent's pod is not there
 * yet (PRODUCT-1736).
 *
 * A hosted write against a pod mid-wake can come back as the waking 503 even
 * after the gateway held it for its whole wake budget: the control plane it
 * asked to wake the pod stalled (a replica restarting under a roll, or wedged
 * behind its own dependencies), and the pod answers seconds to minutes later.
 * The SDK's turn send already walks a delay ladder on exactly this refusal
 * (`turn-stream.ts` resendWhileWaking) and the SDK's board-card writes their
 * own (`activities/busy-retry.ts`); this is the same ladder for the custom
 * integration sign-in mint (`custom-oauth-start.ts`), so a sign-in is not
 * lost to a wake that merely ran long. Any other refusal, an exhausted ladder,
 * or a pod that never answers surfaces the LAST error to the caller, which
 * owns the one report.
 *
 * Pure so `node --test` covers it (app/tests/waking-retry.test.ts): the
 * classifier and the clock are injected.
 */

export interface WakingRetryDeps {
  /** The waking classifier (`isEngineWakingError` in the app). */
  isWaking: (err: unknown) => boolean;
  sleep: (ms: number) => Promise<void>;
  /** Observability hook: fires before each pause, with the refusal it follows. */
  onRetry?: (err: unknown, delayMs: number) => void;
}

export async function retryWhileWaking<T>(
  attempt: () => Promise<T>,
  delaysMs: readonly number[],
  deps: WakingRetryDeps,
): Promise<T> {
  let last: unknown;
  try {
    return await attempt();
  } catch (e) {
    last = e;
  }
  for (const delayMs of delaysMs) {
    if (!deps.isWaking(last)) throw last;
    deps.onRetry?.(last, delayMs);
    await deps.sleep(delayMs);
    try {
      return await attempt();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
