import type { ServerResponse } from "node:http";
import { openSSE } from "../transport/sse";
import type { TurnServerDeps } from "./server-types";
import type { TurnSetupError } from "./turn-layout";
import { createTurnLog } from "./turn-log";
import { turnSetupErrorFrame } from "./turn-terminal";
import type { TurnRequest } from "./types";

/**
 * Answer a setup failure (before any provider work, before any other frame)
 * with a terminal `error` frame on BOTH channels a claimed turn has: this
 * request's SSE stream and the conversation's turnlog. A gateway that lost
 * the stream, or never held one, follows only the turnlog, so a failure the
 * turnlog never saw left the conversation running with nothing to end it.
 * Returns the SSE closer for the turn's cleanup.
 */
export async function answerTurnSetupFailure(opts: {
  deps: TurnServerDeps;
  turn: TurnRequest;
  turnId: string;
  error: TurnSetupError;
  res: ServerResponse;
}): Promise<() => void> {
  const sse = openSSE(opts.res);
  const frame = turnSetupErrorFrame(opts.error, opts.turnId);
  const turnLog = createTurnLog(opts.deps, opts.turn);
  sse.send(turnLog ? turnLog.record(frame) : frame);
  await turnLog?.flush();
  return sse.close;
}
