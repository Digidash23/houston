import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBack } from "@houston/runtime-client/object-sync";
import { startClaimHeartbeat } from "./claim-heartbeat";
import { applyOp } from "./op-apply";
import { partialSyncReply, projectDurableOp } from "./op-durability";
import { WorkerOpDeclinedError } from "./op-provider-guard";
import { executeSeedOp } from "./op-seed";
import { opClaimId, opTreeOptions } from "./op-tree-options";
import { parseOpRequest } from "./parse-op-request";
import type { TurnServerDeps } from "./server-types";
import type { announcedOpEvents } from "./turn-changed-events";
import { prepareTurnFilesystem } from "./turn-filesystem";
import { resolveTurnStore } from "./turn-store";

export { AGENT_IMPORT_CLAIM_ID, AGENT_OPS_CLAIM_ID } from "./op-tree-options";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * POST /op — a write for a sleeping agent, executed here instead of on its
 * pod: claim → hydrate → the real handler → scoped sync-back → doc republish.
 * Answers the handler's own status and body inside `{ok, status, body}` so
 * the gateway relays exactly what the pod would have said.
 */
export async function executeOp(
  deps: TurnServerDeps,
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): Promise<void> {
  let op: ReturnType<typeof parseOpRequest>;
  try {
    op = parseOpRequest(body);
  } catch (error) {
    return json(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const root = await mkdtemp(join(tmpdir(), "houston-op-"));
  const abort = new AbortController();
  const turnLike = { ...op, conversationId: opClaimId(op.op) };
  const heartbeat = startClaimHeartbeat({
    claim: op.claim,
    hostToken: op.hostToken,
    onFenced: () => abort.abort(),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.heartbeatIntervalMs
      ? { intervalMs: deps.heartbeatIntervalMs }
      : {}),
  });
  try {
    const resolved = resolveTurnStore(turnLike, deps.store, {
      poolStoreUrl: deps.poolStoreUrl,
      fetchImpl: deps.fetchImpl,
    });
    if (op.op.kind === "seed") {
      // Decided from the listing before any tree exists: never through the
      // claimed hydrate, which refuses the empty prefix a new agent has.
      const reply = await executeSeedOp({
        deps,
        op: { ...op, op: op.op },
        turn: turnLike,
        store: resolved.store,
        prefix: resolved.prefix,
        root,
        fenced: async () => {
          await heartbeat.checkpoint();
          return heartbeat.fenced;
        },
      });
      return json(res, reply.status, reply.body);
    }
    const filesystem = await prepareTurnFilesystem({
      store: resolved.store,
      prefix: resolved.prefix,
      root,
      claimed: true,
      ...(deps.maxHydrateBytes !== undefined
        ? { maxBytes: deps.maxHydrateBytes }
        : {}),
      ...opTreeOptions(op.op),
    });
    const result = await (deps.runOp ?? applyOp)(
      op,
      filesystem,
      deps.fetchImpl,
    );
    if (result.agentMissing || result.decline) {
      // Not this worker's agent (legacy layout / stale envelope), or a case
      // the worker cannot serve: decline so the gateway takes its fallback,
      // never relay a spurious answer as the pod's.
      return json(res, 200, { ok: true, decline: true });
    }
    await heartbeat.checkpoint();
    if (heartbeat.fenced) return json(res, 409, { error: "claim_fenced" });
    const isRead = op.op.kind === "route" && op.op.method === "GET";
    let announce: ReturnType<typeof announcedOpEvents> = [];
    if (!isRead) {
      const treeOp = op.op.kind === "route" || op.op.kind === "conversation";
      if (result.tooLarge || (treeOp && result.status >= 500)) {
        // A tree-mutating handler failed part-way (a refused lazy read, a
        // 5xx): the overlay may hold HALF a multi-key mutation. Nothing has
        // reached the store yet, so declining is exact — the pod re-runs
        // the write from an unchanged tree instead of the user seeing a
        // split folder. Credential/settings ops have no overlay to leave
        // half-written; their own status (a 502 from the credential store)
        // is the pod's answer too.
        console.error(
          `[op] handler failed before sync: status=${result.status} tooLarge=${result.tooLarge === true} prefix=${resolved.prefix} kind=${op.op.kind}`,
        );
        return json(res, 200, { ok: true, decline: true });
      }
      const synced = await syncBack(
        resolved.store,
        resolved.prefix,
        filesystem.storeRoot,
        filesystem.manifest,
        {
          include: result.include,
          holdDeletesOnFailure: true,
          // A lazy tree's manifest may be EMPTY for a pure create; the
          // listing still told us whether the store mints generations, so a
          // first create stays create-only (CAS "0") instead of blind.
          generations: filesystem.generationAware,
          workerMerge: true,
        },
      );
      const partial = partialSyncReply(
        synced,
        `prefix=${resolved.prefix} kind=${op.op.kind}`,
      );
      if (partial) return json(res, 200, partial);
      if (result.status < 300) {
        announce = await projectDurableOp({
          deps,
          turn: turnLike,
          op,
          filesystem,
          result,
          uploaded: synced.uploaded,
          deleted: synced.deleted,
          source: resolved,
          prefix: resolved.prefix,
        });
      }
    }
    json(res, 200, {
      ok: true,
      status: result.status,
      contentType: result.contentType,
      body: result.body,
      ...(result.bodyBase64 ? { bodyBase64: result.bodyBase64 } : {}),
      ...(result.headers ? { headers: result.headers } : {}),
      events: announce,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof WorkerOpDeclinedError) {
      console.warn(`[op] declined kind=${op.op.kind}: ${message}`);
      if (!res.headersSent) json(res, 200, { ok: true, decline: true });
      return;
    }
    // Loud: a 500 here is the gateway's "worker_500" with no other trace.
    console.error(
      `[op] failed kind=${op.op.kind} ${op.op.kind === "route" ? `${op.op.method} ${op.op.rest}` : ""}: ${message}`,
    );
    if (!res.headersSent) json(res, 500, { error: message });
  } finally {
    try {
      await heartbeat.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
