import {
  loadRoutineRuns,
  routineAutoPauseLogTail,
  routineSnoozeLogTail,
} from "@houston/domain";
import type { HoustonEvent } from "@houston/protocol";
import {
  type ObjectStore,
  syncBack,
} from "@houston/runtime-client/object-sync";
import type { startClaimHeartbeat } from "./claim-heartbeat";
import { partialSyncReply } from "./op-durability";
import type { ReconcileOp } from "./op-grammar-reconcile";
import { applyReconcileOp } from "./op-reconcile-apply";
import { publishReconcile } from "./op-reconcile-publish";
import type { OpClaimTurn } from "./op-republish";
import type { OpRequest } from "./parse-op-request";
import type { TurnServerDeps } from "./server-types";
import { announcedOpEvents } from "./turn-changed-events";
import { claimedTurnIncludes, type TurnFilesystem } from "./turn-filesystem";
import { fsTextStore } from "./turn-fs-store";
import {
  autoPauseRoutineTurn,
  snoozeRoutineTurn,
} from "./turn-routine-auto-pause";

type Reply = { status: number; body: Record<string, unknown> };

/**
 * POST /op `reconcile`: the pod's run reconciliation and its boot settle of
 * an interrupted turn, for a pooled turn that died where neither runs. The
 * conversation's claim scopes every write to what a turn of that conversation
 * may write. Safe to repeat: a retry writes nothing it already wrote, and
 * re-runs every projection, so an attempt that declines on a failed one is
 * finished by the next.
 */
export async function executeReconcileOp(input: {
  deps: TurnServerDeps;
  op: OpRequest & { op: ReconcileOp };
  turn: OpClaimTurn;
  resolved: { store: ObjectStore; prefix: string };
  filesystem: TurnFilesystem;
  heartbeat: ReturnType<typeof startClaimHeartbeat>;
}): Promise<Reply> {
  const { filesystem, heartbeat, resolved } = input;
  const applied = await applyReconcileOp(input.op.op, filesystem);
  if (applied.decline) return decline(`${applied.chat}`, resolved.prefix);
  await heartbeat.checkpoint();
  if (heartbeat.fenced) return { status: 409, body: { error: "claim_fenced" } };
  const events: HoustonEvent[] = [...applied.events];
  let landed: string[] = [];
  if (events.length > 0) {
    const synced = await syncBack(
      resolved.store,
      resolved.prefix,
      filesystem.storeRoot,
      filesystem.manifest,
      {
        include: claimedTurnIncludes(
          filesystem.dataRel,
          filesystem.workspaceRel,
          input.turn.conversationId,
        ),
        holdDeletesOnFailure: true,
        generations: filesystem.generationAware,
        workerMerge: true,
      },
    );
    const partial = partialSyncReply(
      synced,
      `prefix=${resolved.prefix} kind=reconcile`,
    );
    // Only a settlement that landed whole is "done": an attempt that left
    // anything behind declines, and its retry is safe.
    if (partial) return decline("sync-back incomplete", resolved.prefix);
    landed = [...synced.uploaded];
  }
  // Every attempt, from the durable history: a pause the attempt that
  // settled the run never reached is owed still.
  const paused = await pauseAfterSync(input);
  if (paused.failed.length > 0) {
    return decline(
      `auto-pause failed: ${paused.failed.join("; ")}`,
      resolved.prefix,
    );
  }
  events.push(...paused.events);
  const projected = await publishReconcile({
    deps: input.deps,
    turn: input.turn,
    filesystem,
    source: resolved,
    events,
    ...(applied.line ? { line: applied.line } : {}),
    landed,
  });
  if (projected.settle.length > 0) {
    // The files are durable; the retry re-projects them.
    return decline(
      `projection failed: ${projected.settle.join("; ")}`,
      resolved.prefix,
    );
  }
  if (projected.lag.length > 0) {
    console.error(
      `[op] reconcile doc projection lags until the next writer: ${projected.lag.join("; ")} prefix=${resolved.prefix}`,
    );
  }
  return {
    status: 200,
    body: {
      ok: true,
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chat: applied.chat }),
      events: announcedOpEvents(events, projected.lag),
    },
  };
}

/**
 * The pooled auto-pause for each routine with a run in this conversation
 * that settled on a typed wall, read from the history the sync-back left on
 * disk (every row in it is durable): rebased on the store's routines, so a
 * concurrent edit survives, and a no-op once paused or when not earned. A
 * failed pause declines the attempt, so the control plane retries it.
 */
async function pauseAfterSync(input: {
  op: OpRequest & { op: ReconcileOp };
  filesystem: TurnFilesystem;
  resolved: { store: ObjectStore; prefix: string };
}): Promise<{ events: HoustonEvent[]; failed: string[] }> {
  const { items: runs } = await loadRoutineRuns(
    fsTextStore(),
    input.filesystem.workspaceDir,
  );
  const walled = runs.filter(
    (r) => r.session_key === input.op.op.conversationId && r.failure,
  );
  const events: HoustonEvent[] = [];
  const failed: string[] = [];
  for (const routineId of new Set(walled.map((r) => r.routine_id))) {
    const common = {
      store: input.resolved.store,
      prefix: input.resolved.prefix,
      filesystem: input.filesystem,
      routineId,
      nowIso: new Date().toISOString(),
    };
    try {
      // A usage limit snoozes on the one run; every other wall is a streak.
      const limit = walled.find(
        (r) => r.routine_id === routineId && r.failure?.code === "usage_limit",
      )?.failure;
      const changed =
        limit?.code === "usage_limit"
          ? await snoozeRoutineTurn({ ...common, failure: limit })
          : await autoPauseRoutineTurn(common);
      if (!changed) continue;
      console.info(
        changed.snoozed && limit
          ? `[routine-snooze] snoozed ${changed.id}: ${routineSnoozeLogTail(changed.snoozed)}`
          : `[routine-auto-pause] paused ${changed.id} after ${routineAutoPauseLogTail(changed.auto_paused)}`,
      );
      events.push({
        type: "RoutinesChanged",
        agentPath: input.filesystem.workspaceRel.replace(/^workspaces\//, ""),
      });
    } catch (error) {
      failed.push(
        `${routineId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { events, failed };
}

function decline(reason: string, prefix: string): Reply {
  console.warn(`[op] reconcile declined: ${reason} prefix=${prefix}`);
  return { status: 200, body: { ok: true, decline: true } };
}
