import { useEffect } from "react";
import { useManagerHandoffStore } from "../../stores/manager-handoff";

/**
 * Sends the message onboarding left for the manager (the person's "Yes,
 * let's do it" over the instruction to start their goal) as this chat's
 * first turn, through the chat's own send, so it runs on the model the
 * composer shows and lands as the next message under the imported
 * onboarding, with the manager's reply streaming after it.
 */
export function useManagerHandoff(
  sessionKey: string,
  sendAuthored: (
    sessionKey: string,
    text: string,
    context: string,
  ) => Promise<void>,
): void {
  useEffect(() => {
    const handoff = useManagerHandoffStore.getState().take();
    if (handoff === null) return;
    sendAuthored(sessionKey, handoff.text, handoff.context).catch(() => {
      // The send surfaced its own failure (the send-failed toast and its
      // report), as a typed message's would.
    });
  }, [sessionKey, sendAuthored]);
}
