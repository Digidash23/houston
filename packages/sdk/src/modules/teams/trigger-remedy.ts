import type { TriggerStatusItem } from "@houston/wire-types";

export type { TriggerStatusReason } from "@houston/wire-types";

/**
 * What the person should do about a routine's trigger binding.
 *
 * - `reconnect`: the connected account is disconnected; reconnecting it fixes
 *   the binding.
 * - `pick_another_event`: the app no longer offers the event. The binding is
 *   dead until the routine is edited to wake on a different event, and
 *   reconnecting the account changes nothing, so it must never be offered.
 * - `wait_for_provider`: the app refused the setup on its own side; it is
 *   retried automatically and the person has nothing to do.
 * - `none`: healthy, settling, or a failure with no known remedy.
 */
export type TriggerRemedy =
  | "reconnect"
  | "pick_another_event"
  | "wait_for_provider"
  | "none";

/**
 * The remedy for one routine's trigger status. Every surface (the routine
 * screen's chip, the grid, the AI Manager) reads it from here so none decides
 * on its own which status deserves a Reconnect.
 */
export function triggerRemedy(
  item: TriggerStatusItem | undefined,
): TriggerRemedy {
  if (!item) return "none";
  if (item.status === "paused_disconnected") return "reconnect";
  if (item.status !== "error") return "none";
  switch (item.reason) {
    case "trigger_type_gone":
      return "pick_another_event";
    case "config_rejected":
      return "wait_for_provider";
    default:
      return "none";
  }
}
