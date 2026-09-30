import { recordConversationKind } from "@houston/domain";
import type { ChatMessage } from "@houston/runtime-client";
import { estimateTokens } from "./token-estimate";

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

/** What the chat says about the context the next run would start from. */
interface RoutineCarry {
  /** Measured (or, without usage, estimated) tokens; null when nothing is carried. */
  tokens: number | null;
  /** The newest run ended in a context overflow. */
  overflowed: boolean;
  /** The window that overflow named, when the provider named one. */
  namedWindow: number | null;
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
 * `currentTurnId` names the run's own, already-recorded, user message.
 */
export function planRoutineContext(
  conversationId: string,
  messages: ReadonlyArray<ChatMessage>,
  currentTurnId: string,
  windowTokens: number,
): RoutineContextPlan {
  if (!isRoutineConversation(conversationId)) return { reset: false };
  const carry = readCarry(messages, currentTurnId);
  const window = Math.min(windowTokens, carry.namedWindow ?? windowTokens);
  const overLine =
    carry.tokens !== null && carry.tokens >= routineCarryLine(window);
  return carry.overflowed || overLine
    ? { reset: true, carriedTokens: carry.tokens, windowTokens: window }
    : { reset: false };
}

/**
 * Walk the chat back from its newest message to the last point the model's
 * context restarted (a compaction or a `/clear`). The newest turn that
 * reported usage is the measurement: its request size plus its own reply,
 * which the next request carries too. Anything newer than it (a failed run, a
 * provider that reports no usage) is added as a conservative estimate.
 *
 * Both deployments hand this the chat's LIVE transcript file, never its
 * archived segments, so they decide alike. That loses nothing: rotation keeps
 * a ~2 MiB tail live, so a chat whose context restarted before the tail is
 * estimated far past any carry line from the tail alone.
 */
function readCarry(
  messages: ReadonlyArray<ChatMessage>,
  currentTurnId: string,
): RoutineCarry {
  let overflowed = false;
  let namedWindow: number | null = null;
  let sawAssistant = false;
  let estimated = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.contextCleared) break;
    if (m.role === "user" && m.turnId === currentTurnId) continue;
    if (m.role === "assistant" && !sawAssistant) {
      sawAssistant = true;
      if (m.providerError?.kind === "context_overflow") {
        overflowed = true;
        namedWindow = m.providerError.context_window_tokens;
      }
    }
    const measured =
      m.role === "assistant" ? (m.usage?.context_tokens ?? 0) : 0;
    if (measured > 0) {
      const own = measured + (m.usage?.output_tokens ?? 0);
      return { tokens: own + estimated, overflowed, namedWindow };
    }
    estimated += messageTokens(m);
    if (m.compaction) break;
  }
  return {
    tokens: estimated > 0 ? estimated : null,
    overflowed,
    namedWindow,
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
