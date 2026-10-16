import { isRoutineGone } from "@houston/sdk/routines/routine-gone";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useUIStore } from "../stores/ui";
import i18n from "./i18n";

/** `reportQuietError`, injected: its module pulls the analytics graph. */
export type RoutineGoneReport = (
  kind: "routine_gone",
  command: string,
  message: string,
  err: unknown,
) => void;

/**
 * The whole surface of a routine write or run-now refused because the routine
 * no longer exists (`404 routine_not_found`): one info toast with authored
 * copy, never the red bug pair, and ONE fingerprinted quiet warning, since a
 * burst of them means the routines mirror went stale. Always handled.
 */
export function surfaceRoutineGone(
  command: string,
  message: string,
  err: unknown,
  report: RoutineGoneReport,
): true {
  console.warn(`[toast:${command}] ${message}`);
  report("routine_gone", command, message, err);
  useUIStore.getState().addToast({
    title: i18n.t("routines:toasts.goneTitle"),
    description: i18n.t("routines:toasts.goneBody"),
    variant: "info",
  });
  return true;
}

/**
 * Refetch the list a routine was picked from when the host says it is gone.
 * The host already re-projected its routines mirror before answering (the
 * worker's heal), so the refetch reads the list without the ghost.
 */
export function refetchIfRoutineGone(
  qc: Pick<QueryClient, "invalidateQueries">,
  queryKey: QueryKey,
  err: unknown,
): void {
  if (!isRoutineGone(err)) return;
  void qc.invalidateQueries({ queryKey });
}
