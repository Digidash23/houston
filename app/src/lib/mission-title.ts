import type { Capabilities, MissionTitle } from "@houston/engine-adapter";
import { type MissionTitlePlan, planMissionTitle } from "@houston/sdk";
import { queryClient } from "./query-client";
import { queryKeys } from "./query-keys";
import { tauriActivity } from "./tauri";

export { fallbackMissionTitle } from "./mission-title-text";

/**
 * Decide once, per new mission, who titles its card (the SDK's
 * `planMissionTitle`) against the capability snapshot the app already holds.
 * A snapshot not loaded yet keeps the client title flow every deployment
 * serves.
 */
export function missionTitlePlan(
  title: MissionTitle | undefined,
): MissionTitlePlan {
  const capabilities = queryClient.getQueryData<Capabilities>(
    queryKeys.capabilities(),
  );
  return planMissionTitle(capabilities ?? null, title);
}

/**
 * The card's row has landed: run the plan's client title pass (a no-op when
 * the server titles from the send). Never rejects, so it runs detached.
 */
export function titleLandedMission(
  agentPath: string,
  activityId: string,
  plan: MissionTitlePlan,
): void {
  void tauriActivity.titleFromClient(agentPath, activityId, plan.client);
}
