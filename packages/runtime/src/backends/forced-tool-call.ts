/**
 * The HarnessSession's out-of-band forced tool call (`forceToolCall`): ONE
 * extra model request over the turn's finished transcript, plus a hidden
 * instruction, that must answer with a call to one named tool. Nothing of it
 * reaches the session: no wire frame, no persisted entry, no executed tool.
 * The caller reads the call's raw arguments and decides what they mean.
 */
export interface ForcedToolCallRequest {
  /** The tool the model must call; it must already be in the session's toolset. */
  toolName: string;
  /** The hidden instruction, sent as the request's last user message. */
  instruction: string;
  /** Aborts the request (the caller's time cap). */
  signal: AbortSignal;
}

export type ForcedToolCall =
  /** The model called the tool; `args` are its raw, unvalidated arguments. */
  | { outcome: "called"; args: unknown }
  /** The request answered without calling the tool. */
  | { outcome: "not_called" }
  /** The session cannot run the request (tool not offered, no reply to extend). */
  | { outcome: "unavailable"; reason: string }
  /** The model cannot be forced to call a tool, so no request was sent. */
  | { outcome: "unsupported"; reason: string };
