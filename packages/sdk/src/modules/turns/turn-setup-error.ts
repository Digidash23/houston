import { parseTurnSetupFailure } from "@houston/wire-types";
import type { EngineNoticeKind } from "./turn-errors";

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

/** `hydrate_over_cap`: the agent holds more than a worker can open. */
export const AGENT_TOO_LARGE_MESSAGE =
  "Your agent holds too much to start right now. Let the Houston team know and we'll help make room for it.";

/**
 * Every other setup failure, and a conversation still not found well after
 * its send was accepted: nothing ran, so sending again is safe.
 */
export const AGENT_SETUP_FAILED_MESSAGE =
  "Your agent couldn't get ready for this message. Send it again in a moment.";

const MESSAGES: Record<TurnSetupNotice, string> = {
  agent_too_large: AGENT_TOO_LARGE_MESSAGE,
  agent_setup_failed: AGENT_SETUP_FAILED_MESSAGE,
};

export interface TurnSetupSettle {
  message: string;
  notice: TurnSetupNotice;
}

/** The settle for an `error` frame's data when it is a setup failure, else null. */
export function turnSetupSettle(data: unknown): TurnSetupSettle | null {
  const failure = parseTurnSetupFailure(data);
  if (!failure) return null;
  // The code and the worker's detail reach the frontend log; the person only
  // ever sees the notice's copy.
  console.warn("[turn] setup failed:", failure.code, failure.detail ?? "");
  return setupSettle(
    failure.code === "hydrate_over_cap"
      ? "agent_too_large"
      : "agent_setup_failed",
  );
}

export const setupSettle = (notice: TurnSetupNotice): TurnSetupSettle => ({
  message: MESSAGES[notice],
  notice,
});

/**
 * Whether a system line's notice is a setup failure: unexpected, so a
 * surface reports it (without a toast; the line is the whole surface).
 */
export function isTurnSetupNotice(notice: unknown): notice is TurnSetupNotice {
  return notice === "agent_too_large" || notice === "agent_setup_failed";
}
