import { loadRoutines } from "@houston/domain";
import type { Routine } from "@houston/protocol";
import type { Agent, Workspace, WorkspaceRuntime } from "../domain/types";
import type { EventHub } from "../events/hub";
import type { WorkspacePaths } from "../paths";
import type { RuntimeChannel } from "../ports";
import { fireRoutineRun, RoutineBusyError } from "../schedule/run";
import { isUnconnectedRefusal } from "../schedule/run-failure";
import type { Vfs } from "../vfs";
import { assertActingIsCreator } from "./acting";
import { TriggerRoutineFirer } from "./trigger-firer";

/**
 * One external event delivered to a routine. `id` is the DEDUP key — the cloud
 * outbox row id (stringified) on the control-plane→pod path, or Composio's own
 * event id on the self-host in-process path. Both are unique per delivery, so a
 * redelivery replays the same id and the FireLock absorbs it.
 */
export interface TriggerEvent {
  id: string;
  routine_id: string;
  trigger_slug: string;
  payload: unknown;
}

/**
 * The result of firing a batch of trigger events (contract C9 pod route):
 *  - `fired`: a run fired (or every event was already consumed) — the caller
 *    marks all `event_ids` delivered.
 *  - `busy`:  the routine's previous run is still in flight — the caller retries
 *    later (the events stay pending, and this batch's fresh locks are released).
 *  - `no_routine`: no enabled trigger routine matches any event — the caller
 *    marks the events delivered (nothing will ever consume them).
 */
export type FireTriggerResult =
  | { result: "fired"; event_ids: string[] }
  | { result: "busy" }
  | { result: "no_routine" };

/**
 * The cross-replica dedup primitive: atomic set-if-absent PLUS release. The
 * scheduler's `FireLock` only needs `setNx`; trigger delivery also releases a
 * key when its routine is busy, so a redelivery of that event can fire it.
 */
export interface TriggerEventLock {
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
}

export interface FireTriggerDeps {
  vfs: Vfs;
  paths: WorkspacePaths;
  channels: Partial<Record<WorkspaceRuntime, RuntimeChannel>>;
  events?: EventHub;
  lock: TriggerEventLock;
  /** Dedup-lock TTL (s). Must outlast the redelivery/retry window. Default 1h. */
  dedupTtlSec?: number;
  /**
   * The gateway-minted C2 token for the routine's CREATOR, on the control-plane
   * → pod path. It makes the run resolve the creator's credential scope, the
   * same identity a scheduled fire (`routine-fires.ts`) and a Run-now press
   * carry. Without it a pod cannot elevate the bare `created_by` sub (HOU-976
   * D10) and the turn lands on the TEAM credential: in a team space where the
   * creator connected a provider personally, every webhook-woken run failed
   * "creator has no account connected" while chat and Run now worked
   * (PRODUCT-1774). Absent on the self-host in-process path, which has one
   * credential scope anyway.
   */
  actingAs?: string;
  now?: () => Date;
  newId?: () => string;
}

const lockKey = (eventId: string) => `trigger-event:${eventId}`;

/**
 * Fire a batch of trigger events for one agent — the SINGLE firing path shared
 * by the pod route (control-plane→pod) and the self-host webhook ingress, so
 * there is exactly one place that matches events to routines, dedupes, and fires.
 *
 * Semantics (contract C9): events are grouped by routine; only enabled routines
 * carrying a `trigger` binding match. Each event is deduped through the FireLock
 * (`trigger-event:<id>`) so a redelivery — or a crash after firing but before the
 * caller marked delivery — never double-fires. A routine whose events were ALL
 * already consumed is acked without a new run. A fresh batch fires ONE run
 * (`routineTriggerPrompt`). A busy routine releases its just-set locks (so the
 * redelivery re-fires) and returns `busy`. A fire refused because nothing usable
 * is connected consumes its events (its typed errored run is the record); any
 * other fire failure releases them (retryable) and rethrows so the caller
 * surfaces the real reason.
 */
export async function fireTriggerEvents(
  deps: FireTriggerDeps,
  ws: Workspace,
  agent: Agent,
  events: TriggerEvent[],
): Promise<FireTriggerResult> {
  const ttl = deps.dedupTtlSec ?? 3600;
  const root = deps.paths.agentRoot(ws, agent);
  const { items: routines } = await loadRoutines(deps.vfs, root);
  const enabled = new Map<string, Routine>(
    routines.filter((r) => r.enabled && r.trigger).map((r) => [r.id, r]),
  );

  const byRoutine = new Map<string, TriggerEvent[]>();
  for (const e of events) {
    if (!enabled.has(e.routine_id)) continue;
    const group = byRoutine.get(e.routine_id);
    if (group) group.push(e);
    else byRoutine.set(e.routine_id, [e]);
  }
  if (byRoutine.size === 0) return { result: "no_routine" };

  const consumed: string[] = [];
  for (const [routineId, group] of byRoutine) {
    // `enabled` is keyed by the same ids `byRoutine` was built from.
    const routine = enabled.get(routineId) as Routine;
    // Before any lock is burned: a refused delivery must stay re-deliverable.
    if (deps.actingAs) assertActingIsCreator(deps.actingAs, routine);
    const fresh: TriggerEvent[] = [];
    for (const e of group) {
      if (await deps.lock.setNx(lockKey(e.id), "1", ttl)) fresh.push(e);
    }
    // Every event already consumed (a prior fire's replay): ack, no new run.
    if (fresh.length === 0) {
      for (const e of group) consumed.push(e.id);
      continue;
    }
    const firer = new TriggerRoutineFirer(deps.channels, fresh, deps.actingAs);
    try {
      await fireRoutineRun(
        {
          vfs: deps.vfs,
          paths: deps.paths,
          firer,
          events: deps.events,
          now: deps.now ?? (() => new Date()),
          newId: deps.newId ?? (() => crypto.randomUUID()),
        },
        ws,
        agent,
        routine,
      );
      for (const e of group) consumed.push(e.id);
    } catch (err) {
      // Nothing usable is connected: the errored run is recorded and typed,
      // and a redelivery would only fail the same way and add a row, so one
      // event could complete the auto-pause streak alone (PRODUCT-1982).
      // Consume the events like a run that fired and failed.
      if (isUnconnectedRefusal(err)) {
        for (const e of group) consumed.push(e.id);
        continue;
      }
      // Release the just-set locks so the redelivery can re-fire — busy AND any
      // transient fire failure are retryable (fireRoutineRun already recorded an
      // errored run for the non-busy case; the caller marks delivery on retry).
      for (const e of fresh) await deps.lock.del(lockKey(e.id));
      if (err instanceof RoutineBusyError) return { result: "busy" };
      throw err;
    }
  }
  return { result: "fired", event_ids: consumed };
}
