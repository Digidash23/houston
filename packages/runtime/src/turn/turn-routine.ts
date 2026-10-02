import {
  completeRoutineRun,
  createRoutineRun,
  holdsRoutineBusy,
  loadActivities,
  loadRoutineRuns,
  loadRoutines,
  pruneRoutineRuns,
  routineActivity,
  routineConversationId,
  routinePin,
  routinePrompt,
  routineTriggerPrompt,
  saveActivities,
  saveRoutineRuns,
  upsertById,
} from "@houston/domain";
import type { Routine, RoutineRun, RoutineRunFailure } from "@houston/protocol";
import { fsTextStore } from "./turn-fs-store";
import { lastAssistantReply, routineRunError } from "./turn-routine-reply";
import type { TurnRequest } from "./types";

/**
 * The routine phases of a pooled turn. A routine fire dispatched to a worker
 * must behave exactly like the standing host's fireRoutineRun + reconcile:
 * the routine file is the prompt authority, a running row gates double-fires,
 * and the terminal reply classifies the run silent vs surfaced (surfaced runs
 * get their board activity). All of it happens inside the hydrated tree so the
 * claimed sync-back uploads the same files the pod would have written.
 */

export type RoutineTurnFailure = "no_routine" | "routine_busy";

export class RoutineTurnError extends Error {
  constructor(
    readonly code: RoutineTurnFailure,
    message: string,
  ) {
    super(message);
    this.name = "RoutineTurnError";
  }
}

export interface RoutinePhase {
  routine: Routine;
  run: RoutineRun;
  /** The adjusted turn the pi session should execute. */
  text: string;
  model?: string;
  effort?: string;
  provider: string | null;
}

/**
 * Validate the routine, gate on an in-flight run, persist the running row,
 * and derive the prompt + pins — the worker-side twin of fireRoutineRun.
 * The runs write needs no cross-process lock: the conversation claim is the
 * exclusivity domain (one open claim per conversation fleet-wide), narrower
 * than the pod's per-agent runs-file queue.
 */
export async function prepareRoutineTurn(
  workspaceDir: string,
  turn: TurnRequest,
  turnId: string,
  nowIso: string,
): Promise<RoutinePhase> {
  if (!turn.routine) throw new Error("prepareRoutineTurn without routine");
  const store = fsTextStore();
  const { items } = await loadRoutines(store, workspaceDir);
  const routine = items.find((r) => r.id === turn.routine?.id);
  if (!routine) {
    throw new RoutineTurnError(
      "no_routine",
      `routine ${turn.routine.id} not found in the agent's routines`,
    );
  }
  const expected = routineConversationId(routine, turnId);
  if (expected !== turn.conversationId) {
    // The dispatcher derived the conversation from a stale routines doc (for
    // example a chat_mode edit that has not projected yet). The claim is for
    // the WRONG conversation; running anyway would write history where no
    // reader looks. Busy semantics give the dispatcher a clean retry: the
    // next fire re-derives against the refreshed doc.
    throw new RoutineTurnError(
      "routine_busy",
      `conversation ${turn.conversationId} does not match the routine's ${expected}`,
    );
  }
  const { items: runs } = await loadRoutineRuns(store, workspaceDir);
  const nowMs = Date.parse(nowIso);
  // An abandoned `running` row stops blocking past the timeout but stays as
  // it is here: settling it is reconcile's job, by the pod's scheduler while
  // the agent is awake, and otherwise by the control plane's reconcile op
  // (op-reconcile.ts) once no claim holds its conversation.
  if (
    runs.some((r) => r.routine_id === routine.id && holdsRoutineBusy(r, nowMs))
  ) {
    throw new RoutineTurnError(
      "routine_busy",
      `"${routine.name}" is already running`,
    );
  }
  const run = createRoutineRun(routine, turnId, nowIso);
  await saveRoutineRuns(store, workspaceDir, pruneRoutineRuns([run, ...runs]));
  const pin = routinePin(routine);
  const events = turn.routine.events ?? [];
  return {
    routine,
    run,
    text:
      events.length > 0
        ? routineTriggerPrompt(routine, events)
        : routinePrompt(routine),
    ...(pin.model ? { model: pin.model } : {}),
    ...(routine.effort ? { effort: routine.effort } : {}),
    provider: pin.provider,
  };
}

/**
 * Terminal bookkeeping, written into the hydrated tree BEFORE sync-back: the
 * run row leaves "running" (silent/surfaced from the reply, error otherwise),
 * and a surfaced run upserts its board activity — the same rows the pod's
 * reconcile would have produced. A reply that carries a typed provider error
 * is an error run with the same typed `failure` reconcile stamps; `failure`
 * comes from the caller when the turn never reached a provider at all.
 * Resolves to the terminal row, or null when a cancel owned the row.
 */
export async function settleRoutineTurn(opts: {
  workspaceDir: string;
  phase: RoutinePhase;
  conversationId: string;
  turnError?: string;
  failure?: RoutineRunFailure;
  nowIso: string;
  newId: () => string;
}): Promise<RoutineRun | null> {
  const store = fsTextStore();
  const { items: runs } = await loadRoutineRuns(store, opts.workspaceDir);
  const row = runs.find((r) => r.id === opts.phase.run.id);
  // Missing or already-terminal row: a cancel raced the turn — keep what the
  // canceller wrote.
  if (row?.status !== "running") return null;
  // The pooled run's id IS its turn id (prepareRoutineTurn).
  const reply = await lastAssistantReply(
    opts.workspaceDir,
    opts.conversationId,
    row.id,
  );
  const done =
    routineRunError(row, reply, opts) ??
    completeRoutineRun(row, opts.phase.routine, reply.content, opts.nowIso);
  await saveRoutineRuns(store, opts.workspaceDir, upsertById(runs, done));
  if (done.status !== "surfaced") return done;
  const { items: activities } = await loadActivities(store, opts.workspaceDir);
  const existing = activities.find(
    (a) => a.session_key === opts.phase.run.session_key,
  );
  const activity = routineActivity(
    opts.phase.routine,
    done,
    existing,
    opts.newId(),
    opts.nowIso,
  );
  await saveActivities(
    store,
    opts.workspaceDir,
    upsertById(activities, activity),
  );
  return done;
}
