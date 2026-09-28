/**
 * The board-row half of an optimistic mission create (`create-mission-now.ts`):
 * one id-honoring POST (the SDK re-issues it while the agent is busy or waking).
 */

import { isAgentGoneError } from "./agent-gone";
import type {
  CreateMissionAgent,
  CreateMissionOptions,
} from "./create-mission";
import type { MissionIdentity } from "./create-mission-now";
import { getEngine } from "./engine";
import { showErrorToast } from "./error-toast";
import i18n from "./i18n";
import { missionRowInput } from "./mission-row";
import { healStaleRosterFromError } from "./roster-heal";
import { surfaceEngineError, tauriActivity } from "./tauri";

/**
 * Land the board row through the host's single id-honoring POST. Resolves the
 * landed id (differs from ours only under version skew — an engine predating
 * client-supplied ids assigned its own, so its row is stamped with our session
 * key to keep the card opening this chat), or null after toasting: losing the
 * card must never lose the message.
 */
export async function landMissionRow(
  agent: CreateMissionAgent,
  opts: CreateMissionOptions,
  mission: MissionIdentity,
): Promise<string | null> {
  const input = missionRowInput(mission, opts);
  try {
    // The SDK owns the retry: a busy or waking refusal is re-issued inside
    // `activities.writes.create` (`packages/sdk/.../activities/busy-retry.ts`),
    // so only its FINAL error reaches here, reported once below. A second
    // ladder here would stack on the SDK's (PRODUCT-1736).
    const created = await tauriActivity.createWithIdAttempt(
      agent.folderPath,
      input,
    );
    if (created.id !== mission.conversationId) {
      await getEngine().updateActivity(agent.folderPath, created.id, {
        session_key: mission.sessionKey,
      });
    }
    return created.id;
  } catch (e) {
    // The deferred engine-call surface for the final attempt: the log line,
    // the quiet class or the capture, exactly as `createWithId` would have.
    await surfaceEngineError("create_activity", e, undefined, {
      toast: false,
      silence: isAgentGoneError,
    });
    // The agent vanished under the send (deleted/unshared elsewhere): an
    // expected roster-stale state, healed like the warming flush does — not a
    // bug toast the user can't act on.
    if (isAgentGoneError(e)) {
      healStaleRosterFromError(e);
      return null;
    }
    showErrorToast(
      "create_mission_now",
      "mission row create/update failed",
      e,
      {
        userMessage: i18n.t("chat:errors.missionRowFailed"),
      },
    );
    return null;
  }
}
