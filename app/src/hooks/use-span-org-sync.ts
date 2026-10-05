import { useLayoutEffect } from "react";
import type { PerfSpans } from "../lib/perf-spans";

/**
 * Hands the active org slug to the perf spans, which tag each sent turn with
 * the org active when it was sent. A layout effect, so the new org is in place
 * within the commit that switched spaces, before any passive effect or event
 * handler can send in it. Unmounting clears it: the app remounts on every
 * identity change, and the next account must not inherit the org.
 */
export function useSpanOrgSync(
  orgSlug: string | null,
  spans: Pick<PerfSpans, "setOrgSlug">,
): void {
  useLayoutEffect(() => {
    spans.setOrgSlug(orgSlug);
    return () => spans.setOrgSlug(null);
  }, [orgSlug, spans]);
}
