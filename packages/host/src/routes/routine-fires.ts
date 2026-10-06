import type { ServerResponse } from "node:http";
import { loadRoutines } from "@houston/domain";
import { ACTING_AS_HEADER, actingSubFromHeader } from "../auth/acting";
import {
  burnRoutineFireInstant,
  routineFireLockKey,
} from "../schedule/fire-lock";
import {
  decodeFireOutcome,
  encodeFireOutcome,
  type FireOutcome,
  isRetryableFireError,
  unfiredOutcome,
} from "../schedule/fire-outcome";
import { ChannelRoutineFirer } from "../schedule/firer";
import { fireRoutineRun } from "../schedule/run";
import { authorizeAgent, DEFAULT_PATHS } from "./agent-authz";
import { json, readJson } from "./http";
import { defineRoute } from "./registry";

interface RoutineFireBody {
  routineId: string;
  fireAt: Date;
  actingAs: string;
}

function parseBody(raw: unknown): RoutineFireBody | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (
    typeof body.routineId !== "string" ||
    typeof body.fireAt !== "string" ||
    typeof body.actingAs !== "string"
  ) {
    return null;
  }
  const fireAt = new Date(body.fireAt);
  if (Number.isNaN(fireAt.getTime())) return null;
  return { routineId: body.routineId, fireAt, actingAs: body.actingAs };
}

/**
 * What the pod answers the control plane for one delivered instant, always
 * with HTTP 200. `busy` and `failed` are terminal. `deduped` marks the replay
 * of an instant this host already settled: it carries the recorded outcome
 * (and, for `fired`, when that attempt started), or plain `fired` when there
 * is none to replay. Every `result` here is one an older control plane
 * already settles correctly; the extra fields are ignored there.
 */
type RoutineFireReply =
  | { result: "no_routine" }
  | { result: "fired"; deduped?: true; startedAt?: string }
  | { result: "busy"; deduped?: true }
  | { result: "failed"; deduped?: true; code: string | null; error: string };

const reply = (res: ServerResponse, body: RoutineFireReply) =>
  json(res, 200, body);

/** A fresh fire's answer: a fired one's start is only for replays. */
function freshReply(outcome: FireOutcome): RoutineFireReply {
  return outcome.result === "fired" ? { result: "fired" } : outcome;
}

/**
 * POST /agents/:agentId/routine-fires — the control plane delivers ONE
 * scheduled instant to the pod, which fires the routine. Matches BEFORE the
 * generic per-agent runtime dispatch, which has no routine-fire routes.
 *
 * `phase: "user"`, not "agent", for the same reason as trigger-events: the
 * acting-as refusal must answer before ownership is evaluated, so a proxied
 * user request gets a flat 404 rather than an authz relay that confirms whose
 * agent it is.
 */
defineRoute({
  group: "routine-fires",
  method: "POST",
  path: "/agents/:agentId/routine-fires",
  phase: "user",
  classification: "internal-control-plane",
  reason:
    "Server-to-server delivery: the control plane posts a scheduled instant to the pod, never a client.",
  source: "packages/host/src/routes/routine-fires.ts",
  handler: async ({ deps, userId, params, req, res }) => {
    // As with trigger-events, a proxied user request carries this header. The
    // internal delivery uses the pod token and carries its minted C2 token only
    // in the body, so reject externally reachable requests in depth.
    if (req.headers[ACTING_AS_HEADER] !== undefined)
      return json(res, 404, { error: "not found" });

    const authz = await authorizeAgent(deps, userId, params.agentId ?? "");
    if (!authz.ok) return json(res, authz.status, { error: authz.reason });
    if (!deps.vfs)
      return json(res, 503, { error: "agent data not configured" });
    const body = parseBody(await readJson(req));
    if (!body) return json(res, 400, { error: "malformed routine fire" });

    const paths = deps.paths ?? DEFAULT_PATHS;
    const root = paths.agentRoot(authz.workspace, authz.agent);
    const { items: routines } = await loadRoutines(deps.vfs, root);
    const routine = routines.find(
      (candidate) =>
        candidate.id === body.routineId &&
        candidate.enabled &&
        candidate.schedule &&
        !candidate.trigger,
    );
    if (!routine) return reply(res, { result: "no_routine" });

    // Pods do not hold the gateway HMAC key. On this pod-token-authenticated
    // internal route, match the strongest existing trusted-gateway pattern:
    // decode the minted payload and require its subject to equal created_by.
    const actingSub = actingSubFromHeader(body.actingAs);
    if (!actingSub || !routine.created_by || actingSub !== routine.created_by)
      return json(res, 400, {
        error: "acting-as subject does not match routine creator",
        code: "routine_creator_mismatch",
      });
    if (!deps.routineFireLock)
      return json(res, 503, {
        error: "routine fire delivery not configured",
      });

    const ledger = deps.routineFireLock;
    const ttl = deps.routineFireDedupTtlSec ?? 3600;
    const key = routineFireLockKey(routine.id, body.fireAt);
    if (!(await burnRoutineFireInstant(ledger, routine.id, body.fireAt, ttl))) {
      const recorded = decodeFireOutcome(await ledger.get(key));
      return reply(
        res,
        recorded
          ? { ...recorded, deduped: true }
          : { result: "fired", deduped: true },
      );
    }

    const startedAt = new Date().toISOString();
    let outcome: FireOutcome;
    try {
      await fireRoutineRun(
        {
          vfs: deps.vfs,
          paths,
          firer: new ChannelRoutineFirer(deps.channels, body.actingAs),
          events: deps.events,
          now: () => new Date(),
          newId: () => crypto.randomUUID(),
        },
        authz.workspace,
        authz.agent,
        routine,
      );
      outcome = { result: "fired", startedAt };
    } catch (error) {
      if (isRetryableFireError(error)) {
        // Unburn so the redelivery (to this host, its replacement pod, or the
        // agent's new id) fires the instant instead of replaying a miss.
        await ledger.del(key);
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(
          `[routine-fires] routine ${routine.id} fire deferred: ${detail}`,
        );
        return json(
          res,
          503,
          { error: "engine unavailable", detail },
          { "Retry-After": "2" },
        );
      }
      outcome = unfiredOutcome(error);
      if (outcome.result === "failed")
        console.warn(
          `[routine-fires] routine ${routine.id} fire failed (${outcome.code ?? "uncoded"}): ${outcome.error}`,
        );
    }
    await ledger.set(key, encodeFireOutcome(outcome), ttl);
    reply(res, freshReply(outcome));
  },
});
