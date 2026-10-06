import type { ServerResponse } from "node:http";
import { loadRoutines } from "@houston/domain";
import { ACTING_AS_HEADER, actingSubFromHeader } from "../auth/acting";
import { isTurnBusy, TurnFireError } from "../channel/fire-error";
import { burnRoutineFireInstant } from "../schedule/fire-lock";
import { ChannelRoutineFirer } from "../schedule/firer";
import { fireRoutineRun, RoutineBusyError } from "../schedule/run";
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
 * What the pod answers the control plane for one delivered instant. `busy`
 * and `failed` are terminal: the control plane settles them, never retries.
 */
type RoutineFireReply =
  | { result: "fired"; deduped?: true }
  | { result: "no_routine" }
  | { result: "busy" }
  | { result: "failed"; code: string | null; error: string };

/**
 * The reply for a fire that threw AFTER its instant was burned. It must never
 * be a 5xx: the control plane would retry, find the instant burned, and record
 * a deduped "fired" for a routine that never ran. fireRoutineRun has already
 * recorded the run errored with the reason, which is where the person sees it.
 */
function unfiredReply(error: unknown): RoutineFireReply {
  if (error instanceof RoutineBusyError || isTurnBusy(error))
    return { result: "busy" };
  return {
    result: "failed",
    code: error instanceof TurnFireError ? error.code : null,
    error: error instanceof Error ? error.message : String(error),
  };
}

const reply = (res: ServerResponse, body: RoutineFireReply) =>
  json(res, 200, body);

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

    const fresh = await burnRoutineFireInstant(
      deps.routineFireLock,
      routine.id,
      body.fireAt,
      deps.routineFireDedupTtlSec ?? 3600,
    );
    if (!fresh) return reply(res, { result: "fired", deduped: true });

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
      reply(res, { result: "fired" });
    } catch (error) {
      const unfired = unfiredReply(error);
      if (unfired.result === "failed")
        console.warn(
          `[routine-fires] routine ${routine.id} fire failed (${unfired.code ?? "uncoded"}): ${unfired.error}`,
        );
      reply(res, unfired);
    }
  },
});
