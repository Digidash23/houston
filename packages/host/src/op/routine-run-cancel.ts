import type { IncomingMessage, ServerResponse } from "node:http";
import { json, readJson } from "../routes/http";
import { cancelRunRow, type StoppedPooledRun } from "../schedule/cancel";
import type { AgentOpChainDeps } from "./handler-chain";

const RUN_CANCEL = /^routines\/([^/]+)\/runs\/([^/]+)\/cancel$/;

function decoded(segment: string | undefined): string | null {
  try {
    return segment ? decodeURIComponent(segment) : null;
  } catch {
    return null;
  }
}

type Stopped = { ok: true; stopped?: StoppedPooledRun } | { ok: false };

/**
 * The gateway's `{stopped: {sessionKey, startedAt}}`, sent when it released
 * the run's claim for a user stop. The session key must be one of the two
 * conversations the routine's runs use, so the body can only ever describe
 * this run.
 */
async function readStopped(
  req: IncomingMessage,
  routineId: string,
  runId: string,
): Promise<Stopped> {
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch {
    return { ok: false };
  }
  const raw = body.stopped;
  if (raw === undefined) return { ok: true };
  if (typeof raw !== "object" || raw === null) return { ok: false };
  const { sessionKey, startedAt } = raw as Record<string, unknown>;
  const conversations = [
    `routine-${routineId}`,
    `routine-${routineId}-${runId}`,
  ];
  if (typeof sessionKey !== "string" || !conversations.includes(sessionKey))
    return { ok: false };
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt)))
    return { ok: false };
  return { ok: true, stopped: { sessionKey, startedAt } };
}

/**
 * The routine-runs group as a pool worker serves it: the stop only. Firing a
 * run starts a turn, which the gateway's pooled run-now dispatches as a turn,
 * so `routines/:id/run` is left to the chain's 404.
 *
 * A worker has no runtime to abort: the gateway stopped the run's sandbox by
 * releasing its pool claim before this op ran, so the stop here is the row
 * alone (schedule/cancel.ts cancelRunRow), answered exactly as the pod
 * answers it. With `stopped` the gateway vouches the run was live, so a row
 * that never reached the store is recorded instead of answering 404.
 */
export async function handleRoutineRunCancelOp(
  deps: AgentOpChainDeps,
  method: string,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const match = method === "POST" ? RUN_CANCEL.exec(rest) : null;
  const routineId = decoded(match?.[1]);
  const runId = decoded(match?.[2]);
  if (!routineId || !runId) return false;
  const body = await readStopped(req, routineId, runId);
  if (!body.ok) {
    json(res, 400, { error: "invalid 'stopped'" });
    return true;
  }
  const { workspace, agent } = deps.ctx;
  const result = await cancelRunRow(
    { vfs: deps.vfs, paths: deps.paths, now: () => new Date() },
    workspace,
    agent,
    routineId,
    runId,
    body.stopped,
  );
  if (result.status === "not_found") {
    json(res, 404, { error: "run not found" });
    return true;
  }
  if (result.status === "not_running") {
    json(res, 409, { error: "run is not running" });
    return true;
  }
  deps.emit({ type: "RoutineRunsChanged", agentPath: agent.id });
  json(res, 200, result.run);
  return true;
}
