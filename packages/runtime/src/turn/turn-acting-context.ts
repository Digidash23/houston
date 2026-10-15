import type { ActingContext } from "../session/acting-context";
import { localModelContextForTurn } from "./local-model-context";
import type { TurnRequest } from "./types";

/**
 * Who a pooled turn acts as. Its turn record arrived verified (the gateway
 * signed the claim), so the person it names is also the turn's
 * `verifiedOwner`: the one identity that may own a browser hand-off without
 * a signed acting-as token.
 */
export function turnActingContext(
  turn: TurnRequest,
  authPath: string,
  poolStoreUrl: string | undefined,
): ActingContext {
  const owner = turn.actingAs?.userId;
  return {
    credentialScopeKey: `u:turn:${turn.workspaceId}:${turn.agentId}`,
    authPath,
    ...(turn.actingToken ? { actingAs: turn.actingToken } : {}),
    localModelTransport: localModelContextForTurn(turn, poolStoreUrl),
    ...(owner ? { actingUser: owner, verifiedOwner: owner } : {}),
  };
}
