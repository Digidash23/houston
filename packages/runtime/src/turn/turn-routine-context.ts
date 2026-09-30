import { rmSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage } from "@houston/runtime-client";
import {
  isRoutineConversation,
  planRoutineContext,
} from "../session/routine-context";

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
 * On a reset it deletes the conversation's whole hydrated session dir. In the
 * pooled layout pi's session tails, the Claude `sessions.json` mapping and
 * transcript, and the harness marker all live under `sessions/<id>`, and the
 * sync-back propagates the deletes — so the next worker never hydrates the
 * overgrown session again. Must run before the harness marker is written and
 * before the Claude resume is resolved.
 */
export function resetPooledRoutineContext(input: {
  dataDir: string;
  conversationId: string;
  messages: ReadonlyArray<ChatMessage>;
  turnId: string;
  windowTokens: number;
}): PooledRoutineReset | null {
  if (!isRoutineConversation(input.conversationId)) return null;
  const plan = planRoutineContext(
    input.conversationId,
    input.messages,
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
