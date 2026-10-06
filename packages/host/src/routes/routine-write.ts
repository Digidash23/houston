import {
  applyRoutineUpdate,
  createRoutine,
  getPreference,
  isValidTriggerBinding,
  loadRoutines,
  saveRoutines,
  upsertById,
  validateSchedule,
} from "@houston/domain";
import type { NewRoutine, Routine, RoutineUpdate } from "@houston/protocol";
import type { Vfs } from "../vfs";
import { withDocLock } from "./doc-lock";
import {
  NO_TRIGGER_BACKEND_WRITE_ERROR,
  type PlanFloorRefusal,
  planFloorRefusal,
  providerPinError,
  wakeMechanismError,
} from "./routine-write-gates";

/**
 * The merge-safe routine write path, shared by the authenticated agent-data
 * route (routes/agent-data.ts) and the runtime `save_routine` tool's sandbox
 * route (routes/routines-sandbox.ts). BOTH mutate the SAME routines.json through
 * a read-modify-write (loadRoutines -> create/apply -> upsertById -> saveRoutines)
 * so a second write never clobbers a routine a first one persisted. The runtime
 * must NEVER wholesale-replace the file (the isolated-setup-chat bug that deleted
 * task #1 when task #2 was created); this is the one blessed write path.
 */

/** Common gate options for both write paths. */
export interface RoutineWriteOptions {
  /** Whether this deployment can fire event-driven routines (Houston Cloud). */
  triggersEnabled: boolean;
  /** ISO clock the caller supplies (domain stays pure). */
  nowIso: string;
  /** Stable id supplied when an optimistic write may be retried. */
  id?: string;
  /**
   * The fewest minutes between fires the writer's plan allows, as the gateway
   * stamped it: the turn's `limits` for an agent's save, the
   * `x-houston-routine-floor` header for an app or AI Manager write. Absent =
   * no floor (Plus, the desktop, self-host).
   */
  minIntervalMinutes?: number;
}

/** A refused write: the reason the caller relays, plus a code when it has one. */
export type RoutineWriteError = { error: string } | PlanFloorRefusal;

/**
 * Create a routine merge-safely. Runs the SAME create-time gates as the
 * authenticated POST (name/prompt present, exactly one wake, trigger-backend
 * availability, valid cron, plan floor when one is set, known provider pin),
 * then reads the existing file, appends the new routine, and writes the whole
 * survivor set back. Returns the created routine or a plain-language error the
 * caller relays.
 */
export async function createRoutineChecked(
  vfs: Vfs,
  root: string,
  workspaceId: string,
  body: Record<string, unknown>,
  opts: RoutineWriteOptions & { createdBy?: string },
): Promise<{ routine: Routine } | RoutineWriteError> {
  for (const field of ["name", "prompt"]) {
    if (!body[field] || typeof body[field] !== "string") {
      return { error: `missing '${field}'` };
    }
  }
  // Exactly one wake mechanism (a cron schedule OR an event trigger).
  const wakeErr = wakeMechanismError(body);
  if (wakeErr) return { error: wakeErr };
  // No trigger backend here -> a trigger-bound routine could never wake.
  if (body.trigger != null && !opts.triggersEnabled) {
    return { error: NO_TRIGGER_BACKEND_WRITE_ERROR };
  }
  const input = body as unknown as NewRoutine;
  // Reject a bad cron NOW (schedule routines only) — otherwise the routine saves
  // and silently never fires. Validate against the single account-wide zone
  // (HOU-470): there is no per-routine timezone. Trigger routines have no cron.
  if (typeof input.schedule === "string") {
    const accountTz = await getPreference(vfs, workspaceId, "timezone");
    const scheduleErr = validateSchedule(input.schedule, accountTz);
    if (scheduleErr) return { error: `invalid schedule: ${scheduleErr}` };
  }
  // A routine created disabled never fires, so it is exempt (as on update).
  if (input.enabled !== false) {
    const refusal = planFloorRefusal(input.schedule, opts.minIntervalMinutes);
    if (refusal) return refusal;
  }
  const providerErr = providerPinError(body);
  if (providerErr) return { error: providerErr };

  // Load→save under the per-doc lock so concurrent routine writes can't drop
  // each other's entries (same hazard as activities; see doc-lock.ts).
  return await withDocLock(`${root}#routines`, async () => {
    const { items } = await loadRoutines(vfs, root);
    const routine = createRoutine(
      input,
      opts.id ?? crypto.randomUUID(),
      opts.nowIso,
      opts.createdBy,
    );
    await saveRoutines(vfs, root, upsertById(items, routine));
    return { routine };
  });
}

/**
 * Update a routine by id merge-safely. Reads the file, applies the partial update
 * to the matching entry, re-checks the exactly-one-wake invariant on the APPLIED
 * result (e.g. `{trigger: null}` on a trigger routine clears its only wake), the
 * trigger-backend gate, the cron, and the provider pin, then writes the whole set
 * back. `{ notFound: true }` when no routine has that id; else the updated routine
 * or a plain-language error.
 */
export async function updateRoutineChecked(
  vfs: Vfs,
  root: string,
  workspaceId: string,
  itemId: string,
  update: Record<string, unknown>,
  opts: RoutineWriteOptions & { actorSub?: string },
): Promise<{ routine: Routine } | RoutineWriteError | { notFound: true }> {
  // The whole read-modify-write sits inside the lock: re-loading here is what
  // makes the final save apply to the list a concurrent writer just produced.
  return await withDocLock(`${root}#routines`, async () => {
    const { items } = await loadRoutines(vfs, root);
    const current = items.find((r) => r.id === itemId);
    if (!current) return { notFound: true };
    // An update may switch a routine to an event trigger; reject a malformed
    // binding before it is persisted (normalizeRoutines would drop it).
    if (update.trigger != null && !isValidTriggerBinding(update.trigger)) {
      return { error: "invalid 'trigger' binding" };
    }
    const next = applyRoutineUpdate(
      current,
      update as RoutineUpdate,
      opts.nowIso,
      opts.actorSub,
    );
    // The APPLIED result must still hold the exactly-one-wake invariant — persisting
    // a wake-less routine loses it silently (normalizeRoutines drops it on read).
    const nextWakeErr = wakeMechanismError(
      next as unknown as Record<string, unknown>,
    );
    if (nextWakeErr) return { error: nextWakeErr };
    // The APPLIED result carries a trigger, but this deployment cannot fire one →
    // refuse. Converting the routine to a schedule (trigger cleared) passes.
    if (
      (next as { trigger?: unknown }).trigger != null &&
      !opts.triggersEnabled
    ) {
      return { error: NO_TRIGGER_BACKEND_WRITE_ERROR };
    }
    if (typeof next.schedule === "string") {
      const accountTz = await getPreference(vfs, workspaceId, "timezone");
      const scheduleErr = validateSchedule(next.schedule, accountTz);
      if (scheduleErr) return { error: `invalid schedule: ${scheduleErr}` };
    }
    // Every update re-stamps `created_by` to the editor (applyRoutineUpdate),
    // whose plan then judges the fires, so even a prompt-only edit is checked.
    // A routine left disabled never fires, so it is exempt; re-enabling is not.
    if (next.enabled !== false) {
      // "Kept": the schedule is the one already stored, so the refusal says
      // the schedule itself has to move first.
      const refusal = planFloorRefusal(
        next.schedule,
        opts.minIntervalMinutes,
        current.schedule === next.schedule,
      );
      if (refusal) return refusal;
    }
    const providerErr = providerPinError(update);
    if (providerErr) return { error: providerErr };

    await saveRoutines(vfs, root, upsertById(items, next));
    return { routine: next };
  });
}
