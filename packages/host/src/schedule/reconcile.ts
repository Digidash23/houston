import {
  loadActivities,
  loadRoutineRuns,
  loadRoutines,
  routineActivity,
  saveActivities,
  saveRoutineRuns,
  upsertById,
} from "@houston/domain";
import type { Routine, RoutineRun } from "@houston/protocol";
import type { Agent, Workspace } from "../domain/types";
import type { EventHub } from "../events/hub";
import type { WorkspacePaths } from "../paths";
import type { Vfs } from "../vfs";
import { decideRun, type RunUpdate } from "./reconcile-decide";
import { loadRunReplies, type ReplyReader } from "./reconcile-replies";
import { withRunsFile } from "./runs-lock";
import { settleRoutineRuns } from "./snooze";

export interface ReconcileDeps {
  vfs: Vfs;
  paths: WorkspacePaths;
  /** Atomic guard so two replicas don't double-surface the same run. */
  lock: { setNx(key: string, value: string, ttlSec: number): Promise<boolean> };
  events?: EventHub;
  now: () => Date;
  newId: () => string;
  replyReader?: ReplyReader;
  /**
   * What follows the runs that just settled (a usage limit snoozes, an
   * answered run lifts a snooze, other typed walls feed the auto-pause
   * streak). Default: the host's settleRoutineRuns, here and now. A pool
   * worker runs its own after the sync-back instead, rebased on the store's
   * routines.
   */
  settleRuns?: (settled: RoutineRun[]) => Promise<void>;
}

/** Narrows one sweep. The standing scheduler sweeps everything; a pool
 *  worker's reconcile op holds ONE conversation's claim, and knows which
 *  turn of it died. */
export interface ReconcileScope {
  /** Only this conversation's runs: the one the caller's claim covers. */
  conversationId?: string;
  /** Runs whose turn is known dead (its pool claim ended unsettled): they
   *  settle now, as interrupted, unless their turn did answer. */
  abandoned?: ReadonlySet<string>;
}

/**
 * Complete an agent's 'running' routine runs by reading each run's conversation:
 * the agent's reply classifies the run silent vs surfaced (per runner.rs), a
 * surfaced run gets a board Activity, and a run with no reply past the timeout
 * is marked errored (never stuck 'running'). A run whose routine is gone
 * settles too, once its turn is over (reconcile-decide.ts): a `running` row
 * holds the host's busy probe, so skipping it kept an engine awake forever.
 * Idempotent + multi-replica safe: a per-run setNx lock arbitrates, and a
 * terminal run is never revisited.
 *
 * The runs file is RE-READ just before saving and an update lands only when its
 * row is still `running` in the fresh copy: a user cancel that raced this sweep
 * flipped the row terminal first (schedule/cancel.ts), and a stale-snapshot
 * save must never resurrect it. The re-read → save pair runs under the
 * per-agent runs-file queue (runs-lock.ts), so no in-process writer can land
 * between them.
 */
export async function reconcileAgentRuns(
  deps: ReconcileDeps,
  ws: Workspace,
  agent: Agent,
  scope: ReconcileScope = {},
): Promise<void> {
  const root = deps.paths.agentRoot(ws, agent);
  const { items: runs } = await loadRoutineRuns(deps.vfs, root);
  const running = runs.filter(
    (r) =>
      r.status === "running" &&
      (scope.conversationId === undefined ||
        r.session_key === scope.conversationId),
  );
  if (running.length === 0) return;

  const { items: routines, diagnostics } = await loadRoutines(deps.vfs, root);
  const runIds = new Set(runs.map((r) => r.id));
  const nowMs = deps.now().getTime();
  const updates: RunUpdate[] = [];
  // A routines.json the reader had to repair (not an array, an entry dropped
  // as malformed) can hide a live routine: its missing ids prove nothing, so
  // orphans wait until the file reads clean again.
  const candidates = running.flatMap(
    (run): { run: RoutineRun; routine: Routine | null }[] => {
      const routine = routines.find((item) => item.id === run.routine_id);
      if (routine) return [{ run, routine }];
      return diagnostics.length === 0 ? [{ run, routine: null }] : [];
    },
  );
  const replies = await loadRunReplies(
    deps,
    ws,
    agent,
    candidates.map((c) => c.run),
    scope.abandoned,
  );

  for (const [index, { run, routine }] of candidates.entries()) {
    const decision = decideRun({
      run,
      routine,
      reply: replies[index] ?? null,
      nowMs,
      nowIso: deps.now().toISOString(),
      abandoned: scope.abandoned?.has(run.id) === true,
      runIds,
    });
    if (decision.kind === "wait") continue;
    if (decision.kind === "patch") {
      updates.push(decision.update);
      continue;
    }
    // One replica owns this run's completion.
    if (!(await deps.lock.setNx(`routine:reconcile:${run.id}`, "1", 120)))
      continue;
    updates.push(decision.update);
  }
  if (updates.length === 0) return;

  // Board activities for surfaced runs, one batched save. Written BEFORE the
  // runs re-read so the re-read → runs-save pair stays await-free; the corner
  // where a cancel then drops the surfaced update leaves an activity whose
  // content the turn really did produce — acceptable, unlike a resurrected run.
  const surfaced = updates.filter((u) => u.surfacedRoutine);
  if (surfaced.length > 0) {
    const { items: activities } = await loadActivities(deps.vfs, root);
    let nextActivities = activities;
    for (const u of surfaced) {
      if (!u.surfacedRoutine) continue;
      const existing = nextActivities.find(
        (a) => a.session_key === u.run.session_key,
      );
      const activity = routineActivity(
        u.surfacedRoutine,
        u.run,
        existing,
        deps.newId(),
        deps.now().toISOString(),
      );
      nextActivities = upsertById(nextActivities, activity);
      u.run.activity_id = activity.id;
    }
    await saveActivities(deps.vfs, root, nextActivities);
  }

  // Fresh re-read under the per-agent runs-file queue: apply an update only
  // when its row is still `running` — a row a concurrent cancel flipped
  // terminal stays exactly as the user left it, and the queue keeps a
  // mid-flight fire/cancel write from being clobbered by this save.
  const settled: RoutineRun[] = [];
  const applied = await withRunsFile(root, async () => {
    const fresh = await loadRoutineRuns(deps.vfs, root);
    let nextRuns = fresh.items;
    let count = 0;
    for (const u of updates) {
      const current = fresh.items.find((r) => r.id === u.run.id);
      if (current?.status !== "running") continue;
      nextRuns = upsertById(
        nextRuns,
        u.patch ? { ...current, ...u.patch } : u.run,
      );
      if (!u.patch) settled.push(u.run);
      count++;
    }
    if (count > 0) await saveRoutineRuns(deps.vfs, root, nextRuns);
    return count;
  });
  if (applied > 0) {
    deps.events?.emit(ws.ownerUserId, {
      type: "RoutineRunsChanged",
      agentPath: agent.id,
    });
  }
  if (surfaced.length > 0) {
    deps.events?.emit(ws.ownerUserId, {
      type: "ActivityChanged",
      agentPath: agent.id,
    });
  }
  if (deps.settleRuns) await deps.settleRuns(settled);
  else await settleRoutineRuns(deps, ws, agent, root, settled);
}
