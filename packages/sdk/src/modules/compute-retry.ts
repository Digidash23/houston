import { EngineError } from "@houston/runtime-client";
import { parseComputeRefusalText } from "@houston/wire-types";
import type { Clock } from "../ports";
import { COMPUTE_RETRY_BUDGET_MS } from "./http";

/** The pause when a refusal names none, and its floor (as in `http.ts`). */
const DEFAULT_PAUSE_MS = 2_000;
const MIN_PAUSE_MS = 500;

/**
 * Re-run a runtime-client call the gateway refused with a typed nothing-ran
 * refusal (`compute_busy`, `pod_wake_refused`), within the same budget the
 * SDK's REST seam rides it out with (`httpRequest`). The runtime client throws
 * its own `EngineError`, so its calls need this beside them; anything else
 * rethrows at once.
 */
export async function retryComputeRefusals<T>(
  clock: Clock,
  call: () => Promise<T>,
): Promise<T> {
  let paused = 0;
  for (;;) {
    try {
      return await call();
    } catch (e) {
      const refusal =
        e instanceof EngineError && e.status === 503
          ? parseComputeRefusalText(e.body)
          : null;
      if (!refusal) throw e;
      const pause = Math.max(
        MIN_PAUSE_MS,
        refusal.retryAfterMs ?? DEFAULT_PAUSE_MS,
      );
      if (paused + pause > COMPUTE_RETRY_BUDGET_MS) throw e;
      paused += pause;
      await new Promise<void>((resolve) => clock.setTimeout(resolve, pause));
    }
  }
}
