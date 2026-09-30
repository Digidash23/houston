import type { ChatMessage } from "@houston/runtime-client";

/**
 * The one remote assistant row a turn publishes. A turn that compacted before
 * its prompt holds two records under its id: the summary marker it claimed,
 * which carries the compaction boundary (store/conversation-append-assistant),
 * and its own reply or failure card after it. The row is the LAST record, so
 * web history shows the reply or the error card, with the claimed boundary
 * carried onto it, so a web reload still draws the divider and resets the
 * context bar where a desktop reload does.
 */
export function turnRow(
  after: ChatMessage[],
  turnId: string,
): ChatMessage | undefined {
  const own = after.filter(
    (message) => message.role === "assistant" && message.turnId === turnId,
  );
  const last = own.at(-1);
  if (!last || last.compaction) return last;
  const boundary = own.findLast((message) => message.compaction)?.compaction;
  return boundary ? { ...last, compaction: boundary } : last;
}
