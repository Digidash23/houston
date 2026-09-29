import type { NewRoutine, Routine, RoutineUpdate } from "@houston/protocol";

/**
 * Materialize a NewRoutine. Caller supplies identity + clock (domain stays pure).
 * `createdBy` (the authenticated creator's Supabase `sub`) is recorded on the
 * routine so fired turns can act as them (C2); omit it (legacy / single-user)
 * and the field is simply absent — no migration, tolerant read.
 */
export function createRoutine(
  input: NewRoutine,
  id: string,
  nowIso: string,
  createdBy?: string,
): Routine {
  return {
    id,
    name: input.name,
    prompt: input.prompt,
    enabled: input.enabled ?? true,
    suppress_when_silent: input.suppress_when_silent ?? false,
    chat_mode: input.chat_mode ?? "shared",
    // Per-routine provider/model/effort pins. Absent (null) means inherit the
    // agent's config at dispatch — see resolveTurnModel in the runtime.
    provider: input.provider ?? null,
    model: input.model ?? null,
    effort: input.effort ?? null,
    integrations: input.integrations ?? [],
    created_at: nowIso,
    updated_at: nowIso,
    // Exactly one wake mechanism, written only when present — a cron routine
    // carries no `trigger` and a trigger routine no `schedule` (normalizeRoutines
    // drops entries that end up with both or neither). The caller supplies one.
    ...(input.schedule ? { schedule: input.schedule } : {}),
    ...(input.trigger ? { trigger: input.trigger } : {}),
    // Only write the keys when known, so legacy routines stay absent (not "": …).
    ...(input.setup_activity_id
      ? { setup_activity_id: input.setup_activity_id }
      : {}),
    ...(createdBy ? { created_by: createdBy } : {}),
  };
}

/**
 * Apply a partial update. Undefined leaves a field alone. A stray legacy
 * `timezone` key is ignored: the per-routine override was removed in HOU-470
 * (one account-wide zone), so a client still sending it must not write it back.
 * `created_by` is server-owned identity, never client-updateable: only
 * `actorSub` — the server's own verified resolution of WHO is editing (C2) —
 * may re-stamp it. The last verified editor is who a fired routine acts as
 * (they authorized the routine's current shape), and re-stamping on edit also
 * heals routines recorded before gateway-fronted pods stamped real subs.
 */
export function applyRoutineUpdate(
  current: Routine,
  update: RoutineUpdate,
  nowIso: string,
  actorSub?: string,
): Routine {
  // `auto_paused` is engine-owned like `created_by`: only the pause itself
  // writes it (autoPauseRoutine), and resuming is what clears it.
  const defined = Object.fromEntries(
    Object.entries(update).filter(
      ([k, v]) =>
        v !== undefined &&
        k !== "timezone" &&
        k !== "created_by" &&
        k !== "auto_paused",
    ),
  );
  // A null wake key means "clear that mechanism" (the client keeps or moves to
  // the other one — the UI sends `{schedule, trigger: null}` on every cron
  // save). The null itself must never be written, and clearing one side must
  // never delete the other: a routine left with neither wake is dropped by
  // normalizeRoutines on the next read and purged from disk by the next save.
  const clearsTrigger = defined.trigger === null;
  const clearsSchedule = defined.schedule === null;
  if (clearsTrigger) delete defined.trigger;
  if (clearsSchedule) delete defined.schedule;
  // `...current` preserves `created_by` when no verified actor is known — a
  // client can never reassign a routine's acting identity through the body.
  const next = {
    ...current,
    ...defined,
    ...(actorSub ? { created_by: actorSub } : {}),
    updated_at: nowIso,
  } as Routine;
  // A routine has exactly one wake mechanism, so SETTING one clears the other:
  // switching a cron routine to an event wake (or back) must not leave both set,
  // which normalizeRoutines would drop on the next read. Only a real value
  // switches — a null cleared itself above, not its counterpart.
  if (defined.schedule !== undefined) delete next.trigger;
  if (defined.trigger !== undefined) delete next.schedule;
  if (clearsTrigger) delete next.trigger;
  if (clearsSchedule) delete next.schedule;
  if (defined.enabled === true) delete next.auto_paused;
  return next;
}
