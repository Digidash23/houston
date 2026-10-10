import { isAgentWarmingRefusal } from "./agent-warming-refusal";
import { wasToldUser } from "./user-told-mark";

/**
 * The one failure a fan-out write (the same act sent to N agents through
 * `Promise.allSettled`) rethrows, so its optimistic rollback reads it like any
 * single write. A fresh `Error("failed for some agents")` would be unmarked:
 * every offline / waking / warming refusal `call()` already explained would
 * get a second red toast and a Sentry bug with a useless stack.
 *
 * An unexplained reason wins over an explained one, so a real failure is still
 * reported once, with its own stack. Returns when nothing was rejected.
 */
export function throwFirstRefusal(
  settled: readonly PromiseSettledResult<unknown>[],
): void {
  const reasons = settled.flatMap((r) =>
    r.status === "rejected" ? [r.reason as unknown] : [],
  );
  if (reasons.length === 0) return;
  const explained = (err: unknown) =>
    wasToldUser(err) || isAgentWarmingRefusal(err);
  throw reasons.find((err) => !explained(err)) ?? reasons[0];
}
