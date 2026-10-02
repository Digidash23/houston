import type { ChatMessage, RoutineRun } from "@houston/protocol";
import type { Agent, Workspace } from "../domain/types";
import { conversationKey, type WorkspacePaths } from "../paths";
import type { Vfs } from "../vfs";

interface StoredConversation {
  messages: ChatMessage[];
}

/** Present only while the managed transcript dual-write is enabled. */
export interface ReplyReader {
  /** null/undefined means no shadow reply: retain the authoritative file read. */
  replyAfter(
    conversationId: string,
    sinceMs: number,
  ): Promise<ChatMessage | null | undefined>;
}

/**
 * The agent's reply for this run: the last assistant message after the run
 * started. Returns the MESSAGE (not just its text) so the caller can read a
 * persisted providerError — a failed turn appends an empty-content assistant
 * message carrying the typed failure, and that emptiness must classify as
 * "the turn answered (badly)", never "still in flight".
 */
function replyAfter(
  conversation: StoredConversation | null,
  startedAtMs: number,
): ChatMessage | null {
  if (!conversation) return null;
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const m = conversation.messages[i];
    if (!m) continue;
    if (m.role === "assistant" && m.ts >= startedAtMs) return m;
  }
  return null;
}

/** The reply stamped with the run's own turn (a pooled run's id IS its turn
 *  id), else the latest after its start. */
function turnReply(
  conversation: StoredConversation | null,
  run: RoutineRun,
): ChatMessage | null {
  const own = conversation?.messages.findLast(
    (m) => m.role === "assistant" && m.turnId === run.id,
  );
  return own ?? replyAfter(conversation, Date.parse(run.started_at));
}

/**
 * Each run's reply, in `runs` order: the shadow's when it has one, else the
 * conversation file's, where a reply stamped with the run's own id wins over
 * the latest one (in a shared chat a later turn's reply is the latest, and
 * would hide it). A run whose turn is known dead (`abandoned`) reads the file
 * only.
 */
export function loadRunReplies(
  deps: { vfs: Vfs; paths: WorkspacePaths; replyReader?: ReplyReader },
  ws: Workspace,
  agent: Agent,
  runs: readonly RoutineRun[],
  abandoned?: ReadonlySet<string>,
): Promise<(ChatMessage | null)[]> {
  const read = async (cid: string) => {
    const raw = await deps.vfs.readText(
      conversationKey(deps.paths, ws, agent, cid),
    );
    return raw ? (JSON.parse(raw) as StoredConversation) : null;
  };
  return Promise.all(
    runs.map(async (run) => {
      if (abandoned?.has(run.id))
        return turnReply(await read(run.session_key), run);
      const startedAtMs = Date.parse(run.started_at);
      let remoteReply: ChatMessage | null | undefined;
      try {
        remoteReply = await deps.replyReader?.replyAfter(
          run.session_key,
          startedAtMs,
        );
      } catch (error) {
        console.debug(
          `[transcript-shadow] reply-after failed for ${run.session_key}; using file`,
          error,
        );
      }
      if (remoteReply) return remoteReply;
      return turnReply(await read(run.session_key), run);
    }),
  );
}
