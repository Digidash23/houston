import { parseTurnSetupFailure } from "@houston/wire-types";
import type { EngineNoticeKind } from "./turn-errors";
import { finishErr, type TurnState } from "./turn-settle";

/**
 * A pooled turn that failed before any provider work (`TurnSetupFailure`,
 * H-003) settles with a typed notice instead of the worker's bare code, which
 * is developer speak. A surface renders its own copy by kind; these English
 * lines are the defaults for surfaces without a dictionary.
 */
export type TurnSetupNotice = Extract<
  EngineNoticeKind,
  "agent_too_large" | "agent_setup_failed"
>;

/** `hydrate_over_cap`: the agent holds more than a worker can open. A retry
 *  cannot help, and the report already reached us. */
export const AGENT_TOO_LARGE_MESSAGE =
  "This agent has too much saved to start right now. We've been notified and are working on it, so there's nothing you need to do.";

/**
 * Every other setup failure: nothing ran and nothing was saved, so sending
 * again cannot repeat work. Also the line for a turn whose conversation never
 * appeared long after its 202 (`gone`, see `PRESETTLED_GONE_MS`).
 */
export const AGENT_SETUP_FAILED_MESSAGE =
  "Your agent couldn't get ready for this message. Send it again in a moment.";

const MESSAGES: Record<TurnSetupNotice, string> = {
  agent_too_large: AGENT_TOO_LARGE_MESSAGE,
  agent_setup_failed: AGENT_SETUP_FAILED_MESSAGE,
};

/**
 * Settle an `error` frame that is a setup failure; false when it is not one.
 * Nothing was saved, so the optimistic bubble fails like an undelivered send
 * (the 202 only proved the worker answered). The code rides as the item's
 * `cause` for reports; the worker's detail reaches the frontend log.
 */
export function finishSetupError(s: TurnState, data: unknown): boolean {
  const failure = parseTurnSetupFailure(data);
  if (!failure) return false;
  console.warn("[turn] setup failed:", failure.code, failure.detail ?? "");
  const notice: TurnSetupNotice =
    failure.code === "hydrate_over_cap"
      ? "agent_too_large"
      : "agent_setup_failed";
  s.delivered = false;
  finishErr(s, MESSAGES[notice], notice, failure.code);
  return true;
}

/**
 * The pre-settled poll's bound: the accepted turn's conversation never
 * appeared. Not proof that nothing was saved, so the bubble keeps its state.
 */
export function finishGone(s: TurnState): void {
  finishErr(s, AGENT_SETUP_FAILED_MESSAGE, "agent_setup_failed", "gone");
}

/**
 * The report a pushed feed item calls for, or null. A setup failure and a
 * lost terminal are unexpected: the chat line is the person's whole surface
 * (no toast), and this report is ours. Split by source and cause.
 */
export function turnFailureReport(
  item: unknown,
): { source: string; error: Error } | null {
  const it = item as { feed_type?: unknown; notice?: unknown; cause?: unknown };
  if (it.feed_type !== "system_message") return null;
  if (it.notice !== "agent_too_large" && it.notice !== "agent_setup_failed")
    return null;
  const cause = typeof it.cause === "string" ? it.cause : it.notice;
  return cause === "gone"
    ? {
        source: "turn_gone_after_accept",
        error: new Error("turn conversation still not found after its 202"),
      }
    : {
        source: "turn_setup_failed",
        error: new Error(`turn setup failed: ${cause}`),
      };
}
