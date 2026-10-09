import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ReplyBeat } from "../types";

/**
 * Shape reads over the Claude Agent SDK's message union that the turn loop
 * needs but the SDK does not expose as type guards.
 */

/** A main-thread `message_start` stream event — the start of one API response. */
export function isAssistantMessageStart(msg: SDKMessage): boolean {
  return (
    msg.type === "stream_event" &&
    msg.parent_tool_use_id === null &&
    msg.event?.type === "message_start"
  );
}

/**
 * The {@link ReplyBeat} a main-thread stream event carries, if any: a
 * `tool_use` block opening (its input streams with no wire frame until the
 * block stops), or a response stopping on `end_turn` / `stop_sequence` (no
 * tool call to run). A subagent's stream is not this conversation's reply.
 */
export function replyBeatOf(msg: SDKMessage): ReplyBeat | null {
  if (msg.type !== "stream_event" || msg.parent_tool_use_id !== null)
    return null;
  const event = msg.event;
  if (
    event?.type === "content_block_start" &&
    event.content_block?.type === "tool_use" &&
    event.content_block.name
  )
    return { type: "tool_call_start", name: event.content_block.name };
  if (
    event?.type === "message_delta" &&
    (event.delta?.stop_reason === "end_turn" ||
      event.delta?.stop_reason === "stop_sequence")
  )
    return { type: "answer_end" };
  return null;
}

export function hasSessionId(
  msg: SDKMessage,
): msg is SDKMessage & { session_id: string } {
  return (
    "session_id" in msg &&
    typeof (msg as { session_id?: unknown }).session_id === "string"
  );
}
