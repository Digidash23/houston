/**
 * A trigger routine's live status (C9), one item per routine from
 * `GET /v1/agents/:slug/trigger-status`, and the typed reason a degraded
 * binding carries. Split from `./types` (over its size budget) because the
 * reason needs a parser, like `./trigger-plan-skip`.
 */

import type { TriggerPlanSkipped } from "./trigger-plan-skip";

/**
 * A trigger routine's live provisioning status (C9). `active` = the Composio
 * instance is provisioned and delivering; `pending` = reconcile in flight;
 * `paused_disconnected` = the connected account was disconnected;
 * `paused_revoked` = the toolkit fell outside the agent's allowlist;
 * `error` = Composio rejected creation or delivery is failing. A `paused_*` or
 * `error` badge carries a human-readable `detail`.
 */
export type TriggerStatusState =
  | "active"
  | "pending"
  | "paused_disconnected"
  | "paused_revoked"
  | "error";

/** Why a binding is degraded. A CLOSED set: anything else is dropped. */
export const TRIGGER_STATUS_REASONS = [
  /**
   * With `error`. The outside app no longer offers this event (a retired or
   * renamed trigger type). The gateway retries rarely (about daily, backing
   * off to weekly), so a passing catalog miss cannot kill the binding, and
   * immediately once the routine is edited to a different event. Reconnecting
   * the account does not help; picking another event does.
   */
  "trigger_type_gone",
  /**
   * With `error`. The provider refused the trigger's setup (any bad-request
   * answer: its own platform config, e.g. a missing secret, or settings the
   * person chose). The gateway retries with backoff from 30 minutes up to 24
   * hours; if it never starts working, the routine's settings need editing.
   */
  "config_rejected",
  /** With `paused_disconnected`. The connected account must be reauthorized. */
  "needs_reauth",
  /** With `error`. Any other permanent refusal, retried every 6 hours. */
  "rejected",
] as const;

export type TriggerStatusReason = (typeof TRIGGER_STATUS_REASONS)[number];

/**
 * One routine's trigger status. `plan_skipped` counts the routine's events the
 * Free plan refused in the last 24 hours (absent when none); `reason` says why
 * a degraded binding is degraded (absent on a healthy, pending or transiently
 * failing one). The SDK drops either field when it does not parse.
 */
export interface TriggerStatusItem {
  routine_id: string;
  status: TriggerStatusState;
  detail?: string;
  reason?: TriggerStatusReason;
  plan_skipped?: TriggerPlanSkipped;
}

/**
 * The reason, or undefined. A newer gateway may add a reason this client
 * cannot explain, and copy that guessed would tell the person the wrong
 * remedy, so an unknown value reads as no reason at all.
 */
export function parseTriggerStatusReason(
  value: unknown,
): TriggerStatusReason | undefined {
  return isReason(value) ? value : undefined;
}

function isReason(value: unknown): value is TriggerStatusReason {
  return (
    typeof value === "string" &&
    (TRIGGER_STATUS_REASONS as readonly string[]).includes(value)
  );
}
