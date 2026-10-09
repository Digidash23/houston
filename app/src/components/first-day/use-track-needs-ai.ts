import { useEffect } from "react";
import { analytics } from "../../lib/analytics";

/** Surfaces already counted this session: one event each, not one per render. */
const counted = new Set<string>();

/**
 * Count a first-day offer that shows Connect AI instead of its start, now
 * that the refused start no longer reaches Sentry: the share of new hires
 * waiting on a connected AI stays visible in PostHog. Once per session per
 * surface, however many boards mount it.
 */
export function useTrackFirstDayNeedsAi(
  needsAi: boolean,
  surface: "start_button" | "banner",
): void {
  useEffect(() => {
    if (!needsAi || counted.has(surface)) return;
    counted.add(surface);
    analytics.track("agent_first_day_needs_ai", { surface });
  }, [needsAi, surface]);
}
