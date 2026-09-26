import {
  type ConversationImportRequest,
  holdsImport,
  importedMessages,
} from "@houston/protocol";
import {
  loadConversation,
  type StoredConversation,
  saveConversation,
} from "./conversation-file";
import { loadFullConversation } from "./conversation-queries";

/**
 * Write an import's messages at the end of the transcript (or at its start,
 * stamped just before its first line, for `at: "start"`), creating the
 * conversation when it has none, and stamp `needsSessionReplay`: the model's
 * context lives in the backend-native session, which never saw these lines, so
 * the NEXT turn rebuilds its session and carries the whole transcript in as a
 * replay preamble (HOU-951), imported lines included. Pure dir-parameterized
 * file logic like conversation-truncate.ts; the session teardown that must
 * accompany it lives in session/import-conversation.ts.
 *
 * Returns 0 when the transcript already holds this import (its archived
 * segments included), writing nothing.
 */
export function importConversationMessagesAt(
  dir: string,
  id: string,
  request: ConversationImportRequest,
): number {
  const now = Date.now();
  const existing = loadConversation(dir, id);
  if (existing && alreadyImported(dir, existing, request.importId)) return 0;
  const conv: StoredConversation = existing ?? {
    id,
    title: request.messages[0].content.slice(0, 60),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  if (request.at === "start") {
    const first = conv.messages[0]?.ts;
    const messages = importedMessages(request, (first ?? now + 1) - 1);
    conv.messages.unshift(...messages);
    return finish(dir, conv, now, messages.length);
  }
  const messages = importedMessages(request, now);
  conv.messages.push(...messages);
  return finish(dir, conv, now, messages.length);
}

function finish(
  dir: string,
  conv: StoredConversation,
  now: number,
  written: number,
): number {
  delete conv.claudeCompaction;
  conv.needsSessionReplay = true;
  conv.updatedAt = now;
  saveConversation(dir, conv);
  return written;
}

function alreadyImported(
  dir: string,
  conv: StoredConversation,
  importId: string,
): boolean {
  if (holdsImport(conv.messages, importId)) return true;
  if (!conv.archived) return false;
  const full = loadFullConversation(dir, conv.id);
  return full !== null && holdsImport(full.messages, importId);
}
