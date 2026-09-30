import type { ChatMessage } from "@houston/runtime-client";
import { loadConversation, saveConversation } from "./conversation-file";
import type { AssistantMessageMeta } from "./conversation-message-meta";

export function appendAssistantMessageAt(
  dir: string,
  id: string,
  content: string,
  meta: AssistantMessageMeta = {},
) {
  const conv = loadConversation(dir, id);
  if (!conv) return;
  if (meta.contextCleared) delete conv.claudeCompaction;
  // Only a summary marker written for THIS compaction is claimed: it is the
  // newest message (the backend appends it just before the turn's reply). An
  // older unclaimed one (a compaction whose next reply carried no marker) must
  // not move a later boundary back onto it.
  const newest = conv.messages.at(-1);
  const marker =
    meta.compaction && newest?.compaction && !newest.turnId && newest.content
      ? newest
      : undefined;
  if (marker) {
    marker.compaction = meta.compaction;
    marker.turnId = meta.turnId;
    // Only a command's bare marker (`/compact`) folds into the summary. A turn
    // carrying anything of its own (a failure card, a stop, usage, tools, a
    // question) keeps its own message, or a reader would never see it.
    const bare =
      !content &&
      !meta.providerError &&
      !meta.stopped &&
      !meta.usage &&
      !meta.tools?.length &&
      !meta.pendingInteraction &&
      !meta.fileChanges;
    if (bare) {
      conv.updatedAt = Date.now();
      saveConversation(dir, conv);
      return { conversation: conv, message: marker };
    }
  }
  conv.messages.push({
    role: "assistant",
    content,
    ts: Date.now(),
    tools: meta.tools?.length ? meta.tools : undefined,
    thinking: meta.thinking || undefined,
    usage: meta.usage ?? undefined,
    providerSwitch: meta.providerSwitch,
    compaction: marker ? undefined : meta.compaction,
    contextCleared: meta.contextCleared,
    providerError: meta.providerError,
    fileChanges: meta.fileChanges,
    pendingInteraction: meta.pendingInteraction,
    stopped: meta.stopped,
    interrupted: meta.interrupted,
    turnId: meta.turnId,
  });
  conv.updatedAt = Date.now();
  saveConversation(dir, conv);
  return {
    conversation: conv,
    message: conv.messages[conv.messages.length - 1] as ChatMessage,
  };
}
