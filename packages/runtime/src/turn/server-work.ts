/**
 * Work admission for the pooled runtime. Each turn hydrates a throwaway root,
 * runs once, publishes durable changes, then wipes it. Login custody is handled
 * by the server before either work handler can acquire a slot.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_UPLOAD_BODY_BYTES } from "@houston/host/src/turn/files-import";
import type { AdmissionLimiter } from "./admission";
import { executeOp } from "./execute-op";
import { executeTurn } from "./execute-turn";
import { parseTurnRequest } from "./parse-turn-request";
import { json, readJson } from "./server-http";
import type { TurnServerDeps } from "./server-types";
import type { TurnRequest } from "./types";

// An upload rides the op as base64 JSON, with the pod's Files import cap plus
// envelope headroom. It must accept the same body the pod accepts.
const OP_BODY_MAX_BYTES = MAX_UPLOAD_BODY_BYTES + 1024 * 1024;

export async function serveOp(
  deps: TurnServerDeps,
  admission: AdmissionLimiter,
  req: IncomingMessage,
  res: ServerResponse,
) {
  // Admission BEFORE draining the body: at roughly 135 MiB per upload, parked
  // requests must not buffer multiple bodies on a worker with one work slot.
  const releaseOp = admission.tryAcquire();
  if (!releaseOp) {
    return json(res, 503, { error: "worker_full" }, { "Retry-After": "1" });
  }
  try {
    const body = await readJson(req, OP_BODY_MAX_BYTES);
    await executeOp(deps, req, res, body);
  } finally {
    releaseOp();
  }
}

export async function serveTurn(
  deps: TurnServerDeps,
  admission: AdmissionLimiter,
  req: IncomingMessage,
  res: ServerResponse,
  arrival: Record<string, number>,
) {
  let turn: TurnRequest;
  try {
    // The dispatcher may inline up to 16 MiB of agent files as base64.
    turn = parseTurnRequest(await readJson(req, 40 * 1024 * 1024, arrival));
    arrival.t_body_parsed = performance.now();
  } catch (error) {
    return json(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // Local bash is enabled for the single-use worker's ONE claimed turn.
  // An unclaimed real turn could otherwise run bash without spending the
  // worker, allowing serial reuse across tenants. Only a claim carries the
  // tenant boundary. Shadow warm-up runs no pi and needs no claim.
  if (deps.singleUse && !turn.shadow && !turn.claim) {
    return json(res, 400, { error: "single_use_requires_claim" });
  }
  const release = admission.tryAcquire();
  if (!release) {
    return json(res, 503, { error: "worker_full" }, { "Retry-After": "1" });
  }
  // A real claimed turn spends the worker. Shadow warm-up must not spend
  // it, or warming would kill the pod before its first real turn. The slot
  // stays held until begin has latched it spent and isDraining is true.
  const spend = Boolean(turn.claim && !turn.shadow && deps.singleUse);
  try {
    // Re-check AFTER acquiring the slot: a body read may have straddled
    // the worker's one turn after passing the pre-body draining gate.
    if (deps.isDraining?.()) {
      return json(
        res,
        503,
        { error: "worker_draining" },
        { "Retry-After": "1" },
      );
    }
    // Latch BEFORE execution: a crash mid-turn must leave a restarted
    // container refusing further work, as required by single-use.ts.
    if (spend) await deps.singleUse?.begin();
    await executeTurn(deps, turn, req, res, {
      ...arrival,
      t0_request: performance.now(),
    });
  } finally {
    release();
    if (spend) deps.singleUse?.settled();
  }
}
