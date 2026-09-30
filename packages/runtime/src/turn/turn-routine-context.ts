import { rmSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage } from "@houston/runtime-client";
import { carryAfterRun } from "../session/routine-carry";
import {
  isRoutineConversation,
  planRoutineContext,
} from "../session/routine-context";
import { ROUTINE_REPLAY_TAIL } from "../session/routine-replay";
import { getHistoryAt } from "../store/conversation-file";
import {
  readRoutineTranscriptAt,
  writeRoutineCarryAt,
} from "../store/routine-carry";

/** A pooled routine run that starts fresh: its boundary and sizing window. */
export interface PooledRoutineReset {
  compaction: NonNullable<ChatMessage["compaction"]>;
  windowTokens: number;
}

/**
 * The pooled worker's half of the routine context budget
 * (session/routine-context.ts). A pooled turn runs no Houston autocompact at
 * all, so this budget is the only thing standing between a shared routine
 * chat and its model's window here.
 *
 * It decides from the same view as the standing server: the conversation file
 * AFTER this run's user row was appended (so after any rotation that append
 * caused) plus the carry the last run recorded. On a reset it deletes the
 * conversation's whole hydrated session dir. In the pooled layout pi's session
 * tails, the Claude `sessions.json` mapping and transcript, and the harness
 * marker all live under `sessions/<id>`, and the sync-back propagates the
 * deletes, so the next worker never hydrates the overgrown session again. Must
 * run before the harness marker is written and before the Claude resume is
 * resolved.
 */
export function resetPooledRoutineContext(input: {
  dataDir: string;
  conversationId: string;
  turnId: string;
  windowTokens: number;
}): PooledRoutineReset | null {
  if (!isRoutineConversation(input.conversationId)) return null;
  const plan = planRoutineContext(
    input.conversationId,
    readRoutineTranscriptAt(
      join(input.dataDir, "conversations"),
      input.conversationId,
    ),
    input.turnId,
    input.windowTokens,
  );
  if (!plan.reset) return null;
  console.info(
    `[routine] ${input.conversationId}: previous run ended on ${plan.carriedTokens ?? "an overflow of"} tokens (window ${plan.windowTokens}); starting a fresh session with a bounded replay`,
  );
  rmSync(join(input.dataDir, "sessions", input.conversationId), {
    recursive: true,
    force: true,
  });
  return {
    compaction: { trigger: "proactive", pre_tokens: plan.carriedTokens },
    windowTokens: plan.windowTokens,
  };
}

/**
 * What a pooled session rebuild replays from. A routine chat reads the same
 * archive-aware tail as the standing server (`ROUTINE_REPLAY_TAIL` messages,
 * after this run's own user row was appended): a rotation can leave only the
 * newest run live, and the reports before it are the memory the replay keeps.
 * Every other chat keeps its hydrated live file (`canonical`). Only history
 * before this run counts, so an empty result means nothing to carry.
 */
export function routineReplayHistory(
  dataDir: string,
  conversationId: string,
  turnId: string,
  canonical: ChatMessage[],
): ChatMessage[] {
  if (!isRoutineConversation(conversationId)) return canonical;
  const window = getHistoryAt(join(dataDir, "conversations"), conversationId, {
    limit: ROUTINE_REPLAY_TAIL,
  });
  return (window?.messages ?? []).filter(
    (m) => !(m.role === "user" && m.turnId === turnId),
  );
}

/**
 * Record what a finished pooled run of a routine chat left its session
 * holding, before the sync-back ships the conversation file. The standing
 * server's twin is `recordRoutineCarry` (session/routine-session-reset.ts).
 * Never throws: the turn is already over.
 */
export function recordPooledRoutineCarry(input: {
  dataDir: string;
  conversationId: string;
  turnId: string;
  resetBaseTokens: number | undefined;
}): void {
  if (!isRoutineConversation(input.conversationId)) return;
  const dir = join(input.dataDir, "conversations");
  try {
    writeRoutineCarryAt(
      dir,
      input.conversationId,
      carryAfterRun(
        readRoutineTranscriptAt(dir, input.conversationId),
        input.turnId,
        input.resetBaseTokens,
      ),
    );
  } catch (error) {
    console.error(
      `[routine] ${input.conversationId}: could not record the run's context carry:`,
      error,
    );
  }
}
