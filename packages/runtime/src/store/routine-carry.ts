import type { ChatMessage } from "@houston/runtime-client";
import { loadConversation, saveConversation } from "./conversation-file";
import type { RoutineCarryRecord } from "./stored-conversation";

/**
 * A routine chat as its context budget reads it (session/routine-carry.ts):
 * the live file's messages (never the archived segments), the carry the last
 * finished run recorded, and whether older messages were rotated out.
 */
export interface RoutineTranscript {
  messages: ReadonlyArray<ChatMessage>;
  carry?: RoutineCarryRecord;
  rotated: boolean;
}

export function readRoutineTranscriptAt(
  dir: string,
  id: string,
): RoutineTranscript {
  const conv = loadConversation(dir, id);
  return {
    messages: conv?.messages ?? [],
    ...(conv?.routineCarry ? { carry: conv.routineCarry } : {}),
    rotated: (conv?.archived?.segments.length ?? 0) > 0,
  };
}

/** Record the carry a routine run left behind; a missing chat is left alone. */
export function writeRoutineCarryAt(
  dir: string,
  id: string,
  carry: RoutineCarryRecord,
): void {
  const conv = loadConversation(dir, id);
  if (!conv) return;
  saveConversation(dir, { ...conv, routineCarry: carry });
}
