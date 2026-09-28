import type { ServerResponse } from "node:http";
import { NAME_TAKEN } from "@houston/protocol";
import { AgentNameConflictError } from "../ports";
import { json } from "./http";

/**
 * The one answer every agent create, install and rename gives when the name
 * is another agent's: 409 with the protocol's `name_taken` code beside the
 * host's English sentence. Clients classify on the code
 * (`isAgentNameTaken` in @houston/sdk), never on the status alone.
 *
 * Returns true when `err` was that refusal and has been answered; any other
 * error is the caller's to rethrow.
 */
export function answerAgentNameTaken(
  res: ServerResponse,
  err: unknown,
): boolean {
  if (!(err instanceof AgentNameConflictError)) return false;
  json(res, 409, { error: err.message, code: NAME_TAKEN });
  return true;
}
