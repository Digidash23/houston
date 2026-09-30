import type { TurnMode } from "@houston/protocol";
import { effectiveModelWindow } from "@houston/protocol/model-windows";
import type { ResolvedModel } from "../backends/types";
import { config } from "../config";
import { getHistory } from "../store/conversations";
import { serverBackendFor } from "./conversation-backends";
import type { Conversation } from "./conversation-record";
import { clearNativeSessionState } from "./native-session-state";
import type { ReplayPreamble } from "./replay-transcript";
import {
  isRoutineConversation,
  planRoutineContext,
  ROUTINE_HISTORY_TAIL,
} from "./routine-context";
import { renderRoutineReplay, routineReplayCharBudget } from "./routine-replay";

/** A routine run that starts on a fresh session, and what it carries in. */
export interface RoutineSessionReset {
  /** The context the previous run ended on, for the boundary's `pre_tokens`. */
  preTokens: number | null;
  /** The bounded transcript prepended to this run's prompt. */
  replay: ReplayPreamble | null;
}

/**
 * The standing server's half of the routine context budget (routine-context.ts):
 * when the plan calls for it, drop the conversation's backend-native context
 * and rebuild its session fresh, BEFORE the turn's backend and mode switches —
 * the rebuild lands on the resolved model's backend in the turn's mode, so
 * both switches then no-op. Returns null (and touches nothing) otherwise.
 *
 * Reads only the chat's tail (`ROUTINE_HISTORY_TAIL`), so a routine whose
 * transcript has rotated into archive segments costs one live-file read.
 */
export async function resetRoutineSessionIfNeeded(
  conv: Conversation,
  conversationId: string,
  turnId: string,
  prompt: string,
  model: ResolvedModel,
  mode: TurnMode,
): Promise<RoutineSessionReset | null> {
  // Checked before the history read: every other turn skips parsing the file.
  if (!isRoutineConversation(conversationId)) return null;
  const messages =
    getHistory(conversationId, { limit: ROUTINE_HISTORY_TAIL })?.messages ?? [];
  const window = effectiveModelWindow(
    model.provider,
    model.id,
    model.contextWindow,
    0,
  );
  const plan = planRoutineContext(conversationId, messages, turnId, window);
  if (!plan.reset && !conv.sessionRebuildPending) return null;
  console.info(
    plan.reset
      ? `[routine] ${conversationId}: previous run ended on ${plan.carriedTokens ?? "an overflow of"} tokens (window ${plan.windowTokens}); starting a fresh session with a bounded replay`
      : `[routine] ${conversationId}: retrying the fresh session an earlier reset could not build`,
  );
  // Flagged BEFORE the dispose: if the rebuild throws, this record stays the
  // one queue owner and its next turn retries instead of prompting the
  // disposed session (the throw becomes this turn's error).
  conv.sessionRebuildPending = true;
  conv.session.dispose();
  clearNativeSessionState(config.dataDir, conversationId);
  const backend = serverBackendFor(model.provider);
  conv.session = await backend.createSession({
    conversationId,
    model,
    mode,
    fresh: true,
    ...(conv.context ? { context: conv.context } : {}),
  });
  conv.sessionRebuildPending = undefined;
  conv.backendId = backend.id;
  conv.provider = model.provider;
  conv.model = model.id;
  conv.mode = mode;
  return {
    preTokens: plan.reset ? plan.carriedTokens : null,
    replay: renderRoutineReplay(
      messages,
      turnId,
      prompt,
      routineReplayCharBudget(plan.reset ? plan.windowTokens : window),
    ),
  };
}
