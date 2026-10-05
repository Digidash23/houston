import type { TurnServerDeps } from "./server-types";
import type { ActivityDocOptions } from "./turn-activity-doc";
import { poolIdentity } from "./turn-store";
import type { TurnRequest } from "./types";

/**
 * Where a turn publishes one doc family under its claim, or null when the
 * turn has no doc system to project into: a shadow turn, an unclaimed turn,
 * or a deployment with no pool store. Reads there never come from a doc.
 */
export function turnDocTarget(
  deps: TurnServerDeps,
  turn: TurnRequest,
  family: string,
): ActivityDocOptions | null {
  const baseUrl = deps.poolStoreUrl ?? process.env.HOUSTON_POOL_STORE_URL;
  if (turn.shadow || !baseUrl || !turn.claim || !turn.hostToken) return null;
  const { org, agent } = poolIdentity(turn.gcsPrefix);
  return {
    family,
    baseUrl,
    org,
    agent,
    conversationId: turn.conversationId,
    hostToken: turn.hostToken,
    claim: { token: turn.claim.token, bootId: turn.claim.bootId },
    fetchImpl: deps.fetchImpl ?? fetch,
    ...(deps.activityDocRetryDelaysMs
      ? { retryDelaysMs: deps.activityDocRetryDelaysMs }
      : {}),
  };
}
