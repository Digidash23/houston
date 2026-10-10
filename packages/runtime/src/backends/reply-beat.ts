/**
 * A beat of the model's reply the wire dialect does not carry, for the turn's
 * finish marks (session/turn-finish.ts). `tool_call_start`: a main-thread tool
 * call's block opened — its input still streams, and its `tool_start` frame
 * only follows once that input is complete. `answer_end`: an assistant message
 * ended on a clean stop with no tool call, so the model has nothing left to
 * run in it.
 */
export type ReplyBeat =
  | { type: "tool_call_start"; name: string }
  | { type: "answer_end" };
