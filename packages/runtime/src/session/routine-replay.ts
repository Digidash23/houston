import type { ChatMessage } from "@houston/runtime-client";
import {
  type ReplayPreamble,
  renderReplayPreamble,
  replayCharBudget,
} from "./replay-transcript";
import { CHARS_PER_TOKEN, isRoutineConversation } from "./routine-context";

/**
 * The transcript a routine chat carries into a fresh session, and the one rule
 * every rebuild of a routine chat follows: its replay is bounded by the
 * routine budget, never by the 80%-of-window carry an ordinary chat gets. A
 * routine chat is rebuilt for more reasons than its own reset (a provider
 * switch across backends, a Claude replay re-armed after a failed turn), and a
 * replay sized to the window would put the chat right back at the edge the
 * reset just stepped away from.
 */

/** Share of the window a routine chat's replay may use. */
const REPLAY_FRACTION = 0.15;

/**
 * Absolute ceiling on a routine replay: dozens of earlier runs' reports, which
 * is the memory a routine uses (what it already found and said), without
 * re-sending the tool output those runs read.
 */
const REPLAY_CEILING_TOKENS = 24_000;

/** The character budget of a routine chat's replay into a `windowTokens` model. */
export function routineReplayCharBudget(windowTokens: number): number {
  const tokens = Math.min(
    Math.floor(windowTokens * REPLAY_FRACTION),
    REPLAY_CEILING_TOKENS,
  );
  return Math.max(0, tokens) * CHARS_PER_TOKEN;
}

/**
 * Render a routine chat's replay. Every fire sends the routine's full
 * instructions as its user message, so an earlier run whose instructions match
 * this run's is collapsed to one dated line: the budget goes to what the runs
 * found and reported, not to copies of the prompt that follows anyway.
 */
export function renderRoutineReplay(
  messages: ReadonlyArray<ChatMessage>,
  currentTurnId: string,
  currentPrompt: string,
  charBudget: number,
): ReplayPreamble | null {
  const prompt = currentPrompt.trim();
  const collapsed = messages.map((m) =>
    m.role === "user" &&
    m.turnId !== currentTurnId &&
    m.content.trim() === prompt
      ? {
          ...m,
          content: `[Earlier run of this automation at ${new Date(m.ts).toISOString()}, same instructions as this run]`,
        }
      : m,
  );
  return renderReplayPreamble(collapsed, currentTurnId, charBudget, "routine");
}

/** What a rebuilt session of one conversation needs to carry its history in. */
export interface ConversationReplayInput {
  conversationId: string;
  messages: ReadonlyArray<ChatMessage>;
  currentTurnId: string;
  currentPrompt: string;
  /** The active model's effective window, which sizes a routine replay. */
  windowTokens: number;
  /** An ordinary chat's budget, unchanged by this module. */
  charBudget?: number;
  reason?: "switch" | "reset";
}

/**
 * The replay for ANY session rebuild: routine chats get the bounded routine
 * transcript, every other chat exactly the replay it always had.
 */
export function replayForConversation(
  input: ConversationReplayInput,
): ReplayPreamble | null {
  if (isRoutineConversation(input.conversationId))
    return renderRoutineReplay(
      input.messages,
      input.currentTurnId,
      input.currentPrompt,
      routineReplayCharBudget(input.windowTokens),
    );
  return renderReplayPreamble(
    input.messages,
    input.currentTurnId,
    input.charBudget ?? replayCharBudget(input.windowTokens),
    input.reason,
  );
}
