import { useEffect } from "react";
import { analytics } from "../../lib/analytics";
import { logAndReportError } from "../../lib/error-report";
import { sendManagerHandoff } from "../../lib/manager-onboarding/send-handoff";
import { useManagerHandoffStore } from "../../stores/manager-handoff";

/**
 * Sends the kickoff onboarding left for the manager as this chat's first
 * turn, through the chat's own send, so it runs on the model the composer
 * shows and lands as the next message under the imported onboarding, drawn
 * as the goal card.
 */
export function useManagerHandoff(
  sessionKey: string,
  sendAuthored: (
    sessionKey: string,
    text: string,
    context: string,
    grants: ["createAgent"],
  ) => Promise<void>,
  /** A turn is running: the kickoff waits for it to end. */
  busy: boolean,
): void {
  useEffect(() => {
    void sendManagerHandoff(
      () => useManagerHandoffStore.getState().take(),
      (handoff) => useManagerHandoffStore.getState().handOff(handoff),
      sessionKey,
      (key, handoff) =>
        sendAuthored(key, handoff.text, handoff.context, handoff.grants),
      () => analytics.track("onboarding_goal_handoff"),
      busy,
    ).catch((error: unknown) =>
      logAndReportError("onboarding_goal_handoff_send", error),
    );
  }, [sessionKey, sendAuthored, busy]);
}
