import type { ChatMessage } from "@houston/runtime-client";
import type { RoutineCarryRecord } from "../store/conversation-file";
import type { RoutineTranscript } from "../store/routine-carry";
import { estimateTokens } from "./token-estimate";

/**
 * How much context a routine chat's backend session holds, read from the
 * chat itself (routine-context.ts decides what to do about it).
 *
 * Every finished run RECORDS what it left the session holding
 * (`carryAfterRun`, stored on the conversation). The record is what makes the
 * decision independent of transcript rotation: a run whose own messages
 * outgrow the live file's budget is archived whole by the next run's user row,
 * leaving nothing live to measure, and the standing server (which reads after
 * that append) and a pooled worker (which hydrated before it) would otherwise
 * decide differently.
 */
export interface RoutineCarry {
  /** Tokens the session holds; null when nothing is carried. */
  tokens: number | null;
  /** The newest run ended in a context overflow. */
  overflowed: boolean;
  /** The window that overflow named, when the provider named one. */
  namedWindow: number | null;
  /** Older history was rotated away and nothing measures it: assume the worst. */
  unknown: boolean;
}

/**
 * Walk the chat back from its newest message (skipping `skipTurnId`'s own user
 * row) to the first thing that measures the session: the recorded carry of a
 * run, a run's reported usage (its request size plus its own reply, which the
 * next request carries too), or the last point the context restarted (a
 * compaction or a `/clear`). Anything newer than the measurement is added as a
 * conservative estimate.
 */
export function readCarry(
  transcript: RoutineTranscript,
  skipTurnId?: string,
): RoutineCarry {
  const { messages, carry, rotated } = transcript;
  let overflowed = false;
  let namedWindow: number | null = null;
  let sawAssistant = false;
  let estimated = 0;
  const measuredAt = (tokens: number | null): RoutineCarry => ({
    tokens:
      tokens === null && estimated === 0 ? null : (tokens ?? 0) + estimated,
    overflowed,
    namedWindow,
    unknown: false,
  });
  const fromRecord = (record: RoutineCarryRecord): RoutineCarry => ({
    ...measuredAt(record.tokens),
    // Nothing newer than the recorded run is live: its outcome is the newest.
    ...(sawAssistant
      ? {}
      : { overflowed: record.overflowed, namedWindow: record.namedWindow }),
    unknown: record.tokens === null && rotated,
  });
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.contextCleared) return measuredAt(null);
    if (m.role === "user" && m.turnId === skipTurnId) continue;
    if (m.role === "assistant" && !sawAssistant) {
      sawAssistant = true;
      if (m.providerError?.kind === "context_overflow") {
        overflowed = true;
        namedWindow = m.providerError.context_window_tokens;
      }
    }
    if (carry && m.turnId === carry.turnId) return fromRecord(carry);
    const measured =
      m.role === "assistant" ? (m.usage?.context_tokens ?? 0) : 0;
    if (measured > 0)
      return measuredAt(measured + (m.usage?.output_tokens ?? 0));
    estimated += messageTokens(m);
    if (m.compaction) return measuredAt(null);
  }
  if (carry) return fromRecord(carry);
  if (rotated) return { ...measuredAt(null), tokens: null, unknown: true };
  return measuredAt(null);
}

/**
 * The carry run `turnId` leaves behind, from the transcript right after its
 * reply was persisted. Its own reported usage when there is one; otherwise
 * what the session held before it (the replay it started from, when it
 * reset) plus an estimate of its own messages.
 */
export function carryAfterRun(
  transcript: RoutineTranscript,
  turnId: string,
  resetBaseTokens?: number,
): RoutineCarryRecord {
  const own = transcript.messages.filter((m) => m.turnId === turnId);
  let reply: ChatMessage | undefined;
  for (const m of own) if (m.role === "assistant") reply = m;
  const error = reply?.providerError;
  const overflow = error?.kind === "context_overflow" ? error : undefined;
  const outcome = {
    turnId,
    overflowed: overflow !== undefined,
    namedWindow: overflow?.context_window_tokens ?? null,
  };
  const measured = reply?.usage?.context_tokens ?? 0;
  if (reply?.usage && measured > 0)
    return { ...outcome, tokens: measured + reply.usage.output_tokens };
  const before: RoutineCarry =
    resetBaseTokens !== undefined
      ? {
          tokens: resetBaseTokens,
          overflowed: false,
          namedWindow: null,
          unknown: false,
        }
      : readCarry({
          ...transcript,
          messages: transcript.messages.filter((m) => m.turnId !== turnId),
        });
  let ownTokens = 0;
  for (const m of own) ownTokens += messageTokens(m);
  return {
    ...outcome,
    tokens: before.unknown ? null : (before.tokens ?? 0) + ownTokens,
  };
}

/** What a message puts back into the next request, in (estimated) tokens. */
function messageTokens(m: ChatMessage): number {
  let tokens = estimateTokens(m.content);
  for (const tool of m.tools ?? []) {
    tokens += estimateTokens(tool.name) + estimateTokens(tool.result ?? "");
    if (tool.input !== undefined)
      tokens += estimateTokens(JSON.stringify(tool.input));
  }
  return tokens;
}
