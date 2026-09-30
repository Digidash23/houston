import { rmSync } from "node:fs";
import { join } from "node:path";
import { cleanupClaudeConversation } from "../backends/claude/cleanup";
import { conversationCompactions } from "../store/conversation-compaction";

/**
 * Delete everything the backends keep as a conversation's MODEL context, and
 * nothing else: the transcript the person reads (and `houston_recall`
 * searches) is Houston's own store and stays whole.
 *
 * Two backends store that context in two places, so this clears both: pi's
 * per-conversation session dir (`<dataDir>/sessions/<id>`), and the Claude
 * Agent SDK backend's `sessions.json` mapping + transcript JSONL + its armed
 * compaction checkpoint. Each is a no-op for a conversation that never ran on
 * that backend, so callers need not know which provider the chat used.
 *
 * The compaction checkpoint goes FIRST, before anything that can fail: it arms
 * the next prompt with a summary of the very history being deleted, and while
 * it is armed the Claude backend will not resume a session either. Dropping it
 * last would let a failed teardown leave a conversation that answers from a
 * summary of turns that are gone.
 */
export function clearNativeSessionState(
  dataDir: string,
  conversationId: string,
): void {
  conversationCompactions.clear(conversationId);
  rmSync(join(dataDir, "sessions", conversationId), {
    recursive: true,
    force: true,
  });
  cleanupClaudeConversation(dataDir, conversationId);
}
