import {
  loadRoutineRuns,
  pruneRoutineRuns,
  saveRoutineRuns,
  upsertById,
} from "@houston/domain";
import type { RoutineRun } from "@houston/protocol";
import type { Agent, Workspace } from "../domain/types";
import type { EventHub } from "../events/hub";
import type { WorkspacePaths } from "../paths";
import type { ChannelCtx, RuntimeChannel } from "../ports";
import type { Vfs } from "../vfs";
import { withRunsFile } from "./runs-lock";

/** The row store a cancel settles in: no runtime, no events. */
export interface CancelRowDeps {
  vfs: Vfs;
  paths: WorkspacePaths;
  now: () => Date;
}

export interface CancelRunDeps extends CancelRowDeps {
  channel: RuntimeChannel;
  events?: EventHub;
}

/**
 * A pooled run whose sandbox a person already stopped: the gateway released
 * the run's pool claim with a user-stop reason. Its row may never have reached
 * the store, because a pooled run lands its row only when it settles, and a
 * stopped worker lands nothing. These are the facts the row needs.
 */
export interface StoppedPooledRun {
  /** The run's conversation (the claim's), the row's `session_key`. */
  sessionKey: string;
  /** When the run's claim was taken, the row's `started_at`. */
  startedAt: string;
}

export type CancelRowResult =
  | { status: "cancelled"; run: RoutineRun }
  | { status: "not_found" }
  | { status: "not_running" };

export type CancelRunResult =
  | {
      status: "cancelled";
      run: RoutineRun;
      /**
       * The row is cancelled but the live-turn abort failed — the runtime may
       * still be burning the turn. Surfaced to the caller (no-silent-failures)
       * on top of the loud host log.
       */
      abortFailed: boolean;
    }
  | { status: "not_found" }
  | { status: "not_running" };

/**
 * Settle a run's row as cancelled, under the per-agent runs-file queue —
 * reconcile re-checks row status before its own save, so a
 * concurrently-finishing turn can never flip a cancelled run back (the Rust
 * cancel_run ordering). Only a `running` row moves; a settled one answers
 * not_running. A row that is missing is unknown, unless `stopped` says the
 * run was live: then the cancelled row is recorded from those facts, the
 * one row the stopped run will ever have.
 */
export async function cancelRunRow(
  deps: CancelRowDeps,
  ws: Workspace,
  agent: Agent,
  routineId: string,
  runId: string,
  stopped?: StoppedPooledRun,
): Promise<CancelRowResult> {
  const root = deps.paths.agentRoot(ws, agent);
  return withRunsFile(root, async (): Promise<CancelRowResult> => {
    const { items } = await loadRoutineRuns(deps.vfs, root);
    const run = items.find((r) => r.id === runId && r.routine_id === routineId);
    if (run && run.status !== "running") return { status: "not_running" };
    const live = run ?? stoppedRow(routineId, runId, stopped);
    if (!live) return { status: "not_found" };
    const cancelled: RoutineRun = {
      ...live,
      status: "cancelled",
      summary: "Stopped by user",
      completed_at: deps.now().toISOString(),
    };
    // A recorded row is the newest run: it goes first, as every writer
    // prepends, and the per-routine cap applies to it like to any new run.
    const next = run
      ? upsertById(items, cancelled)
      : pruneRoutineRuns([cancelled, ...items]);
    await saveRoutineRuns(deps.vfs, root, next);
    return { status: "cancelled", run: cancelled };
  });
}

function stoppedRow(
  routineId: string,
  runId: string,
  stopped: StoppedPooledRun | undefined,
): RoutineRun | null {
  if (!stopped) return null;
  return {
    id: runId,
    routine_id: routineId,
    status: "running",
    session_key: stopped.sessionKey,
    started_at: stopped.startedAt,
  };
}

/**
 * Stop an in-flight routine run on the host that runs it: the row goes
 * terminal FIRST (cancelRunRow), then the live turn is aborted through the
 * workspace's channel; an abort failure is reported (never swallowed) but the
 * run stays cancelled — the user asked it to stop.
 */
export async function cancelRoutineRun(
  deps: CancelRunDeps,
  ws: Workspace,
  agent: Agent,
  routineId: string,
  runId: string,
): Promise<CancelRunResult> {
  const flipped = await cancelRunRow(deps, ws, agent, routineId, runId);
  if (flipped.status !== "cancelled") return flipped;
  deps.events?.emit(ws.ownerUserId, {
    type: "RoutineRunsChanged",
    agentPath: agent.id,
  });

  const ctx: ChannelCtx = { workspace: ws, agent };
  try {
    await deps.channel.cancelTurn(ctx, flipped.run.session_key);
  } catch (err) {
    // The row is already terminal; this only means the runtime may still be
    // burning the turn. Loud on purpose — a stuck abort is a real bug signal.
    console.error(
      `[routines] turn abort failed for run ${runId}:`,
      err instanceof Error ? err.message : err,
    );
    return { ...flipped, abortFailed: true };
  }
  return { ...flipped, abortFailed: false };
}
