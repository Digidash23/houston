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

/**
 * POST /op `reconcile`: the pod's run reconciliation and its boot settle of
 * an interrupted turn, for a pooled turn that died where neither runs. The
 * conversation's claim scopes every write to what a turn of that conversation
 * may write. Safe to repeat: a second run finds the reply written and the run
 * settled, and writes nothing.
 */
export async function executeReconcileOp(input: {
  deps: TurnServerDeps;
  op: OpRequest & { op: ReconcileOp };
  turn: OpClaimTurn;
  resolved: { store: ObjectStore; prefix: string };
  filesystem: TurnFilesystem;
  heartbeat: ReturnType<typeof startClaimHeartbeat>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { filesystem, heartbeat, resolved } = input;
  const applied = await applyReconcileOp(input.op.op, filesystem);
  if (applied.decline) {
    console.warn(
      `[op] reconcile declined: ${applied.chat} prefix=${resolved.prefix}`,
    );
    return { status: 200, body: { ok: true, decline: true } };
  }
  await heartbeat.checkpoint();
  if (heartbeat.fenced) return { status: 409, body: { error: "claim_fenced" } };
  const answer = (events: string[]) => ({
    status: 200,
    body: {
      ok: true,
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chat: applied.chat }),
      events,
    },
  });
  if (applied.events.length === 0) return answer([]);
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
  if (partial) return { status: 200, body: partial };
  const failures = await publishReconcile({
    deps: input.deps,
    turn: input.turn,
    filesystem,
    source: resolved,
    events: applied.events,
    ...(applied.landed ? { landed: applied.landed } : {}),
    uploaded: synced.uploaded,
  });
  if (failures.length > 0) {
    // Durable already: the next reconcile, op or turn re-projects.
    console.error(
      `[op] reconcile projection failed after a durable sync: ${failures.join("; ")} prefix=${resolved.prefix}`,
    );
  }
  return answer(announcedOpEvents(applied.events, failures));
}
