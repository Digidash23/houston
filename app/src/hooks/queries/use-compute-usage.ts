import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../lib/query-keys";
import { tauriOrg } from "../../lib/tauri";
import { useAdminScreenActive } from "../use-admin-screen-active";

/** The org chart's window: the days its time worked counts, ending today. */
export const COMPUTE_USAGE_DAYS = 30;

/**
 * Per-agent time worked over the org chart's window.
 *
 * Cloud-only: the caller passes `enabled` from `capabilities.computeUsage`,
 * so no request can ever fire on desktop/self-host (where the route does not
 * exist). Scoping is server-side: members get only their assigned agents.
 *
 * Closed days never change, but an agent that is running right now grows
 * "today" continuously. There is no pod wake/sleep `HoustonEvent` to
 * invalidate on (same as {@link useOrgUsage}); space switches already drop
 * the whole query cache. Failures report through `tauriOrg.computeUsage` ->
 * `call()`; the chart keeps the last good data on screen.
 */
export function useComputeUsage(enabled: boolean) {
  const active = useAdminScreenActive();
  return useQuery({
    queryKey: queryKeys.computeUsage(COMPUTE_USAGE_DAYS),
    queryFn: () => tauriOrg.computeUsage(COMPUTE_USAGE_DAYS),
    // Time worked is read inside Admin, and Admin is kept alive: it stays
    // mounted while hidden, on whichever section it was left on. Disable the
    // observer off screen so neither its interval nor its focus refetch wakes
    // a pod-held read. Gate on the SCREEN that renders it: gating on any other
    // view id disables the observer exactly when the section is on the glass
    // and the fetch never fires. Admin mounts only the section the user
    // selected, so no observer exists while another section is up.
    enabled: enabled && active,
    staleTime: 20_000,
    // The pod flushes its report on every turn start/end (edge-triggered), so
    // a 30s poll while an agent is up keeps fresh numbers visible within
    // seconds of work happening; idle agents relax to a 5-minute tick.
    refetchInterval: (query) =>
      (query.state.data?.awakeNow.length ?? 0) > 0 ? 30_000 : 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
