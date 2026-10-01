import type { ChatMessage, ToolEntry } from "./feed-to-messages";
import type { FeedItem } from "./types";

type ToolResultItem = Extract<FeedItem, { feed_type: "tool_result" }>;

function openCall(
  message: ChatMessage | null | undefined,
  item: ToolResultItem,
): ToolEntry | undefined {
  if (message?.from !== "assistant") return undefined;
  return message.tools.find(
    (candidate) =>
      !candidate.result &&
      (item.data.name === undefined || candidate.name === item.data.name),
  );
}

/**
 * Pair a result with the call it answers. Results may arrive after several
 * calls and after a thinking block flush, so the current turn (everything
 * since the last user row) is searched in call order first. A user row can
 * also land mid-turn (a teammate writing while the agent works), so a result
 * with no open call in that stretch falls back to the calls before it, the
 * most recent first.
 */
export function attachToolResult(
  item: ToolResultItem,
  messages: ChatMessage[],
  active: ChatMessage | null,
): void {
  let start = messages.length;
  while (start > 0 && messages[start - 1]?.from !== "user") start--;
  let tool: ToolEntry | undefined;
  for (let i = start; i <= messages.length && !tool; i++)
    tool = openCall(i === messages.length ? active : messages[i], item);
  for (let i = start - 1; i >= 0 && !tool; i--)
    tool = openCall(messages[i], item);
  if (!tool) return;
  tool.result = {
    content: item.data.content,
    is_error: item.data.is_error,
    ...(item.data.mission ? { mission: item.data.mission } : {}),
  };
}
