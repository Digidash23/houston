import type { WireFrame } from "@houston/runtime-client";
import { publish } from "./bus";
import type { Conversation } from "./conversation-cache";

/**
 * The publish every frame of an executing turn goes through: stamps the turn's
 * id, and drops the frame once the user has STOPPED that turn.
 *
 * cancelTurn publishes the turn's terminal "Stopped by user" frame and only
 * then aborts, so everything the turn still says while pi unwinds lands AFTER
 * the terminal frame: the aborted tool's `tool_end`, the aborted `turn_end`'s
 * `usage` (an all-zero one for an aborted codex generation), the file diff
 * computed once prompt() resolves. The stream snapshot (bus.ts) reads every
 * non-terminal frame as "running", so a single one of them re-opens a turn that
 * already ended and leaves the conversation running until its next turn
 * completes. The frames are only dropped from the live stream: the persisted
 * assistant message is built from the turn's own accumulators, so it still
 * records the tool's outcome, the usage and the diff.
 */
export function turnFramePublisher(
  conv: Pick<Conversation, "stoppedTurnId">,
  id: string,
  turnId: string,
): (frame: WireFrame) => void {
  return (frame) => {
    if (conv.stoppedTurnId === turnId) return;
    publish(id, { ...frame, turnId });
  };
}
