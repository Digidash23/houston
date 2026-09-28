import type { ServerResponse } from "node:http";
import {
  RESERVED_AGENT_NAME_MESSAGE,
  takesReservedAgentName,
} from "@houston/domain";
import { NAME_RESERVED } from "@houston/protocol";
import { json } from "./http";

/**
 * The one answer every agent create, install and rename gives when the name
 * would newly take the AI Manager's own ("Houston"): 400 with the protocol's
 * `name_reserved` code beside a sentence the AI Manager can act on. Clients
 * classify on the code (`isAgentNameReserved` in @houston/sdk).
 *
 * Enforced only where this host IS the user-facing edge (desktop, self-host).
 * Behind the gateway (`gatewayFronted`, the managed pod) the gateway enforces
 * the rule itself and also seeds each pod through `POST /agents` under the
 * agent's registered name, so an existing "Houston" employee must never be
 * refused there.
 *
 * `currentName` is the agent's name before a rename, so an employee that
 * already holds the name keeps it. Returns true when the request has been
 * answered.
 */
export function refuseReservedAgentName(
  deps: { gatewayFronted?: boolean },
  res: ServerResponse,
  name: string,
  currentName?: string,
): boolean {
  if (deps.gatewayFronted || !takesReservedAgentName(name, currentName))
    return false;
  json(res, 400, { error: RESERVED_AGENT_NAME_MESSAGE, code: NAME_RESERVED });
  return true;
}
