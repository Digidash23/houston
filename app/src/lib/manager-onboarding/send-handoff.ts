import type { ManagerHandoff } from "../../stores/manager-handoff.ts";

/**
 * Taking the pending handoff makes a remounted chat unable to send it twice.
 * A send that fails puts it back, so the next chat to open sends it again
 * instead of losing the person's goal. While the chat is `busy` the handoff
 * waits: queued behind a running turn, it would merge with whatever the
 * person queued there and lose its card.
 */
export async function sendManagerHandoff(
  take: () => ManagerHandoff | null,
  restore: (handoff: ManagerHandoff) => void,
  sessionKey: string,
  send: (sessionKey: string, handoff: ManagerHandoff) => Promise<void>,
  track: () => void,
  busy: boolean,
): Promise<void> {
  if (busy) return;
  const handoff = take();
  if (handoff === null) return;
  try {
    await send(sessionKey, handoff);
  } catch (error) {
    restore(handoff);
    throw error;
  }
  track();
}
