import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ModelCallTiming } from "@houston/protocol";

/**
 * Turn pi's event stream into one `ModelCallTiming` per answered request.
 * `turn_start` precedes each request (the auth refresh and context transform
 * before the fetch count as request time); an auto-retry's request goes out
 * after its backoff. The assistant `message_start` fires when the provider's
 * response opens, and the first `text_start` / `toolcall_start` is the first
 * answer token. A call that errored or was aborted reports nothing: its
 * timings describe a failure, not the provider's latency.
 */
export function createPiCallTimer(
  now: () => number = () => performance.now(),
): (event: AgentSessionEvent) => ModelCallTiming | null {
  let requestAt: number | undefined;
  let openedAt: number | undefined;
  let firstTokenAt: number | undefined;
  return (e) => {
    if (e.type === "turn_start") {
      requestAt = now();
      openedAt = firstTokenAt = undefined;
    } else if (e.type === "auto_retry_start") {
      requestAt = now() + e.delayMs;
      openedAt = firstTokenAt = undefined;
    } else if (e.type === "message_start" && e.message.role === "assistant") {
      openedAt ??= now();
    } else if (e.type === "message_update") {
      const t = e.assistantMessageEvent.type;
      if (t === "text_start" || t === "toolcall_start") firstTokenAt ??= now();
    } else if (e.type === "message_end" && e.message.role === "assistant") {
      const msg = e.message;
      const call =
        requestAt !== undefined &&
        openedAt !== undefined &&
        msg.stopReason !== "error" &&
        msg.stopReason !== "aborted"
          ? {
              provider: msg.provider,
              model: msg.model,
              ttfbMs: Math.max(0, Math.round(openedAt - requestAt)),
              ...(firstTokenAt !== undefined
                ? { firstTokenMs: Math.round(firstTokenAt - openedAt) }
                : {}),
              inputTokens: msg.usage?.input ?? 0,
              cacheReadTokens: msg.usage?.cacheRead ?? 0,
              cacheWriteTokens: msg.usage?.cacheWrite ?? 0,
              outputTokens: msg.usage?.output ?? 0,
            }
          : null;
      requestAt = openedAt = firstTokenAt = undefined;
      return call;
    }
    return null;
  };
}
