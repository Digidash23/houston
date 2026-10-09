import type { TriggerStatusItem } from "@houston/engine-adapter";
import { triggerRemedy } from "@houston/sdk";

/** The headline for a trigger binding that needs attention. */
export type ActivationAlertLabelKey =
  | "trigger.status.paused_disconnected"
  | "trigger.status.paused_revoked"
  | "trigger.status.error";

/** Authored detail copy, in the `routines` namespace. */
export type ActivationAlertHintKey =
  | "trigger.statusDisconnectedHint"
  | "trigger.statusRevokedHint"
  | "trigger.statusTriggerGoneHint"
  | "trigger.statusConfigRejectedHint";

export type ActivationAlertDetail =
  | { kind: "hint"; key: ActivationAlertHintKey }
  | { kind: "server"; text: string }
  | null;

export interface ActivationAlertView {
  labelKey: ActivationAlertLabelKey;
  detail: ActivationAlertDetail;
  /** Only when reconnecting the account is what fixes the binding. */
  showReconnect: boolean;
}

/**
 * What the routine screen's alert block says, from the SDK's `triggerRemedy`.
 * A dead event or a refusal the app retries on its own gets authored copy
 * instead of the host's English `detail`, which names no remedy, and never a
 * Reconnect, which would not help. Pure, so it unit-tests under bare node.
 */
export function activationAlertView(
  status: TriggerStatusItem | undefined,
): ActivationAlertView {
  const state = status?.status;
  const remedy = triggerRemedy(status);
  const labelKey: ActivationAlertLabelKey =
    state === "paused_disconnected"
      ? "trigger.status.paused_disconnected"
      : state === "paused_revoked"
        ? "trigger.status.paused_revoked"
        : "trigger.status.error";
  return {
    labelKey,
    detail: alertDetail(status, remedy),
    showReconnect: remedy === "reconnect",
  };
}

function alertDetail(
  status: TriggerStatusItem | undefined,
  remedy: ReturnType<typeof triggerRemedy>,
): ActivationAlertDetail {
  if (remedy === "pick_another_event")
    return { kind: "hint", key: "trigger.statusTriggerGoneHint" };
  if (remedy === "wait_for_provider")
    return { kind: "hint", key: "trigger.statusConfigRejectedHint" };
  if (status?.detail) return { kind: "server", text: status.detail };
  if (status?.status === "paused_disconnected")
    return { kind: "hint", key: "trigger.statusDisconnectedHint" };
  if (status?.status === "paused_revoked")
    return { kind: "hint", key: "trigger.statusRevokedHint" };
  return null;
}
