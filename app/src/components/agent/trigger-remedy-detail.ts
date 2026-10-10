import type { TriggerStatusItem } from "@houston/engine-adapter";
import { type TriggerRemedy, triggerRemedy } from "@houston/sdk";

/** Authored copy for the remedies the host's English `detail` cannot name. */
export type TriggerRemedyHintKey =
  | "trigger.statusTriggerGoneHint"
  | "trigger.statusConfigRejectedHint";

/** The `routines` key that tells the person what to do, if the remedy has one. */
export function remedyHintKey(
  remedy: TriggerRemedy,
): TriggerRemedyHintKey | null {
  switch (remedy) {
    case "pick_another_event":
      return "trigger.statusTriggerGoneHint";
    case "check_settings":
      return "trigger.statusConfigRejectedHint";
    default:
      return null;
  }
}

/**
 * The item with its `detail` replaced by the authored remedy copy when the
 * SDK's `triggerRemedy` has one, so every surface (the grid's badge reads
 * `detail` as is) shows the localized instruction instead of the host's
 * English. Returns the item untouched otherwise.
 */
export function withRemedyDetail(
  item: TriggerStatusItem,
  translate: (key: TriggerRemedyHintKey) => string,
): TriggerStatusItem {
  const key = remedyHintKey(triggerRemedy(item));
  return key ? { ...item, detail: translate(key) } : item;
}

/** `withRemedyDetail` over a per-row status map; the same map when unchanged. */
export function withRemedyDetails(
  statuses: Record<string, TriggerStatusItem>,
  translate: (key: TriggerRemedyHintKey) => string,
): Record<string, TriggerStatusItem> {
  let out: Record<string, TriggerStatusItem> | null = null;
  for (const [id, item] of Object.entries(statuses)) {
    const next = withRemedyDetail(item, translate);
    if (next === item) continue;
    out ??= { ...statuses };
    out[id] = next;
  }
  return out ?? statuses;
}
