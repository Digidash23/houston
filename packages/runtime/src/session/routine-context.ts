import { recordConversationKind } from "@houston/domain";
import type { RoutineTranscript } from "../store/routine-carry";
import { readCarry } from "./routine-carry";

/**
 * THE ROUTINE CONTEXT BUDGET: what keeps a shared routine chat from outgrowing
 * its model's window.
 *
 * A shared routine (the default chat mode) runs every fire in ONE conversation
 * for as long as the routine exists, and the backend-native session (pi's
 * session file, the Claude SDK session it resumes) carries every earlier run
 * into the next one, tool output included. Autocompact cannot hold that line:
 * it needs a live context fill, which a freshly built Claude session does not
 * have (every fire after an idle eviction, a restart, or on a pooled worker),
 * and it compacts by asking the model to summarize the whole session, which is
 * refused as too long once the session is already past the window. Past that
 * point every fire fails with `context_overflow`, forever.
 *
 * So a routine run never starts from more than a fixed share of the window:
 * when the context the previous run ended on reached the carry line, or that
 * run overflowed outright, this run starts on a FRESH backend session carrying
 * only a bounded transcript of the chat's most recent runs (routine-replay.ts).
 * No model call is involved, so the reset itself cannot fail the way a
 * summarization can. A chat that stays under the line is untouched and keeps
 * resuming its session with full fidelity.
 */

/** Share of the window the carried context may reach before a run resets. */
const CARRY_FRACTION = 0.5;

/**
 * Absolute ceiling on the carried context, whatever the catalog says. A 1M
 * catalog window can still be a 200k window on the account's plan, which no
 * fraction of the catalog number would respect, and an unattended run that
 * re-reads hundreds of thousands of tokens on every fire burns the plan's
 * quota for nothing.
 */
const CARRY_CEILING_TOKENS = 100_000;

/** Whether this conversation is a routine's chat (shared or per-run). */
export function isRoutineConversation(conversationId: string): boolean {
  return recordConversationKind(conversationId) === "routine";
}

/** The carried context (tokens) at which a routine run resets its session. */
export function routineCarryLine(windowTokens: number): number {
  return Math.min(
    Math.floor(windowTokens * CARRY_FRACTION),
    CARRY_CEILING_TOKENS,
  );
}

export type RoutineContextPlan =
  | { reset: false }
  | {
      reset: true;
      /** What the previous run ended on, for the boundary's `pre_tokens`. */
      carriedTokens: number | null;
      /** The window the reset sizes against (the smaller of catalog and named). */
      windowTokens: number;
    };

/**
 * Decide whether THIS run of `conversationId` must start on a fresh session.
 * `windowTokens` is the active model's effective window (model-windows.ts);
 * `currentTurnId` names the run's own, already-recorded, user message. The
 * transcript is the chat's live file plus the carry its last run recorded
 * (routine-carry.ts), identical on the standing server and a pooled worker.
 */
export function planRoutineContext(
  conversationId: string,
  transcript: RoutineTranscript,
  currentTurnId: string,
  windowTokens: number,
): RoutineContextPlan {
  if (!isRoutineConversation(conversationId)) return { reset: false };
  const carry = readCarry(transcript, currentTurnId);
  const window = Math.min(windowTokens, carry.namedWindow ?? windowTokens);
  const overLine =
    carry.tokens !== null && carry.tokens >= routineCarryLine(window);
  return carry.unknown || carry.overflowed || overLine
    ? { reset: true, carriedTokens: carry.tokens, windowTokens: window }
    : { reset: false };
}
