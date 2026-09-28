import type { IncomingMessage } from "node:http";
import type { ActivityContributor, MissionStarter } from "@houston/protocol";
import { actingAuthorFor, routineActorFor } from "../auth/acting";
import { isAssistantRequest } from "../auth/assistant-call";
import type { UserId } from "../domain/types";

/** What the typed `.houston` families stamp from WHO made the request. */
export interface AgentDataCaller {
  /**
   * The verified acting identity of THIS request (C2), recorded as a new
   * routine's `created_by` and re-stamped on PATCH, so a fired routine turn
   * acts as whoever last shaped it. Gateway-fronted pods pass the gateway-
   * minted acting sub (the id the gateway re-authorizes at fire time, HOU-689);
   * the desktop passes its local owner. Absent in callers that don't carry
   * identity; the field then stays as-is (absent on create).
   */
  createdBy?: string;
  /**
   * The verified acting human as a full contributor (C2): activities stamp
   * `created_by` + a contributor entry from it (routines take the sub-only
   * `createdBy` above). Absent off the gateway, keeping single-player
   * activity.json byte-identical.
   */
  author?: ActivityContributor;
  /**
   * Whether this deployment can fire event-driven routines (a trigger backend
   * exists, Houston Cloud only). When false, a routine write carrying a
   * `trigger` binding is rejected: it could never wake here (a schedule can).
   * Reads still list existing trigger routines; the gate applies to writes only.
   */
  triggersEnabled?: boolean;
  /** `houston` when the AI Manager made this request: a card it creates is
   *  stamped `started_by` (PRODUCT-1928). Absent for everyone else. */
  startedBy?: MissionStarter;
}

/** The caller facts of one routed request, each read from what the host
 *  verified (`auth/acting.ts`, `auth/assistant-call.ts`), never from the body. */
export function agentDataCaller(
  deps: {
    gatewayFronted?: boolean;
    ownerSub?: string;
    triggersEnabled?: boolean;
  },
  req: IncomingMessage,
  userId: UserId,
): AgentDataCaller {
  const createdBy = routineActorFor(deps, req, userId);
  const author = actingAuthorFor(deps, req);
  return {
    ...(createdBy ? { createdBy } : {}),
    ...(author ? { author } : {}),
    triggersEnabled: deps.triggersEnabled ?? false,
    ...(isAssistantRequest(deps, req) ? { startedBy: "houston" as const } : {}),
  };
}
