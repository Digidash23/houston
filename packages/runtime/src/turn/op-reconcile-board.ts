import {
  loadActivities,
  loadRoutineRuns,
  loadRoutines,
  routineActivity,
  saveActivities,
  upsertById,
} from "@houston/domain";
import type { Vfs } from "@houston/host/src/vfs";
import type { RoutineRun } from "@houston/protocol";

/**
 * Give every surfaced run of the conversation the board card its row points
 * at. The host's reconcile writes the card and then the row; a sync-back
 * that landed the row but not the card declines, and its retry finds the
 * run already settled, so it re-creates the card from the row instead.
 * Answers whether the board changed.
 */
export async function repairSurfacedCards(
  vfs: Vfs,
  root: string,
  conversationId: string,
  nowIso: string,
): Promise<boolean> {
  const { items: runs } = await loadRoutineRuns(vfs, root);
  const surfaced = runs.filter(
    (r) =>
      r.session_key === conversationId &&
      r.status === "surfaced" &&
      r.activity_id,
  );
  if (surfaced.length === 0) return false;
  const { items: cards } = await loadActivities(vfs, root);
  const missing = surfaced.filter(
    (r) => !cards.some((card) => card.id === r.activity_id),
  );
  if (missing.length === 0) return false;
  // A shared chat's runs share one card: it carries the newest of them.
  const newest = new Map<string, RoutineRun>();
  for (const run of missing) {
    const id = run.activity_id ?? "";
    const held = newest.get(id);
    if (!held || Date.parse(run.started_at) > Date.parse(held.started_at))
      newest.set(id, run);
  }
  const { items: routines } = await loadRoutines(vfs, root);
  let next = cards;
  for (const run of newest.values()) {
    const routine = routines.find((r) => r.id === run.routine_id);
    if (!routine || !run.activity_id) continue;
    const existing = next.find((card) => card.session_key === run.session_key);
    next = upsertById(
      next,
      routineActivity(routine, run, existing, run.activity_id, nowIso),
    );
  }
  if (next === cards) return false;
  await saveActivities(vfs, root, next);
  return true;
}
