import { markTurnOnce } from "./turn-network-marks";

/** How one POST of a turnlog batch ended. */
export type TurnLogPostResult = "stored" | "retry" | "refused" | "route_absent";

/** Statuses worth a resend; any other refusal (a fenced claim) is final. */
const RETRYABLE = new Set([502, 503, 504]);
/** A timer this much later than due was held up by a stalled event loop. */
const STALL_MS = 100;
/** Fresh windows stalls may buy one request before its deadline aborts it. */
const MAX_STALL_WINDOWS = 2;

/**
 * An abort only live event-loop time can spend. After a synchronous stall a
 * plain `AbortSignal.timeout` fires before the poll phase reads the socket, so
 * a request whose answer had already arrived, or that never got the chance to
 * go out, reads as failed (2026-10-02: pi walked a cyclic session for 6 to
 * 11 s). A timer that runs late was held up by such a stall, so the request
 * gets a fresh window instead.
 */
export function liveDeadline(
  ms: number,
  now: () => number = () => performance.now(),
): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let windows = 0;
  const arm = () => {
    const due = now() + ms;
    timer = setTimeout(() => {
      if (now() - due > STALL_MS && windows < MAX_STALL_WINDOWS) {
        windows += 1;
        arm();
        return;
      }
      controller.abort(
        new DOMException(`timed out after ${ms} ms`, "TimeoutError"),
      );
    }, ms);
    timer.unref?.();
  };
  arm();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** POST one batch once and classify the outcome; never throws. */
export async function postTurnLogBatch(input: {
  fetchImpl: typeof fetch;
  url: string;
  init: Omit<RequestInit, "method" | "signal">;
  timeoutMs: number;
  carriesText: boolean;
}): Promise<TurnLogPostResult> {
  const deadline = liveDeadline(input.timeoutMs);
  try {
    const response = await input.fetchImpl(input.url, {
      ...input.init,
      method: "POST",
      signal: deadline.signal,
    });
    markTurnOnce("t_turnlog_first_post_done");
    if (input.carriesText) markTurnOnce("t_turnlog_text_post_done");
    if (response.ok) return "stored";
    if (response.status === 404) return "route_absent";
    // Decided before the body is read: a body that fails to arrive must never
    // turn a final refusal into a resend.
    const result = RETRYABLE.has(response.status) ? "retry" : "refused";
    console.warn(
      `[turnlog] batch failed (${response.status}): ${await bodyExcerpt(response)}`,
    );
    return result;
  } catch (error) {
    console.warn(
      "[turnlog] batch failed:",
      error instanceof Error ? error.message : String(error),
    );
    return "retry";
  } finally {
    deadline.clear();
  }
}

async function bodyExcerpt(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch (error) {
    return `unreadable body (${error instanceof Error ? error.message : String(error)})`;
  }
}
