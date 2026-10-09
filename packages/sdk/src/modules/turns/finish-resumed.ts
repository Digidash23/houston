import { setReplyPhase } from "./reply-phase";
import { invisibleFinal, push, type TurnState } from "./turn-settle";

/**
 * Settle a turn the ENGINE interrupted and is ALREADY running again by itself
 * (`interrupted.resumed`, PRODUCT-1785). Neither of the other settles fits: the
 * turn did not succeed, and it did not fail either — a second turn is on its
 * way with the same work. So: finalize whatever streamed, push the pause line,
 * stop the progress indicator, and leave `terminal` NULL so the board card
 * keeps its `running` status. Handing the card back to the user (`needs_you`)
 * or reddening it (`error`) would both lie about an agent that is still working.
 */
export function finishResumed(s: TurnState, msg: string): void {
  if (s.settled) return;
  // An early hand-back is taken back: the card stays running for the resume.
  if (s.replyComplete) setReplyPhase(s, false);
  s.settled = true;
  if (s.thinking) push(s, { feed_type: "thinking", data: s.thinking });
  if (s.text) push(s, { feed_type: "assistant_text", data: s.text });
  push(s, { feed_type: "system_message", data: msg, notice: "engine_resumed" });
  s.firstResponse?.resolve("interrupted", s.turnId);
  invisibleFinal(s);
  s.output.sessionStatus(s.agentPath, s.sessionKey, "completed");
}
