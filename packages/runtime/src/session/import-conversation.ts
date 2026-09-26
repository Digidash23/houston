import type { ConversationImportRequest } from "@houston/protocol";
import { importConversationMessages } from "../store/conversations";
import { evict } from "./bus";
import { disposeConversation } from "./chat";
import {
  beginConversationCommand,
  conversationCommandBusy,
} from "./conversation-command-gate";

/**
 * Write lines said elsewhere into a conversation as real history, running no
 * turn (the AI Manager's scripted onboarding, `POST …/import`).
 *
 * The transcript is not what the model reads: its context lives in the
 * backend-native session store. So an import that wrote anything tears that
 * session down exactly as the edit-and-resend rewind does
 * (`truncate-turn.ts`): dispose the live session, delete both backends'
 * native state, and evict the event channel so a connected client resyncs
 * against the longer history. The store write stamped `needsSessionReplay`,
 * so the next turn opens a fresh session carrying the whole transcript, the
 * imported lines in their place, as its replay preamble. A replayed
 * transcript is how every rebuilt session learns its history, so imported
 * lines reach the model the same way any earlier turn does after a rebuild.
 *
 * Rides the conversation-command gate like the rewind: a turn accepted,
 * queued or running on the chat answers "busy" and nothing is written, since
 * tearing its session out from under it would lose the turn.
 */
export async function importConversation(
  id: string,
  request: ConversationImportRequest,
): Promise<"busy" | { imported: number }> {
  if (conversationCommandBusy(id)) return "busy";
  const settle = beginConversationCommand(id);
  try {
    const imported = importConversationMessages(id, request);
    if (imported > 0) {
      await disposeConversation(id, { deleteSessions: true });
      evict(id);
    }
    return { imported };
  } finally {
    settle();
  }
}
