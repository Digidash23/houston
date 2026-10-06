import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ModelCallTiming } from "@houston/protocol";
import type { HarnessTimingEvent } from "../types";

/** The Messages API stream events this timer reads (main thread only). */
interface StreamEventLike {
  type?: string;
  message?: { model?: string; usage?: UsageLike };
  content_block?: { type?: string };
  usage?: UsageLike;
}

interface UsageLike {
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens?: number | null;
}

/** Block types that are the reply's first answer token (not thinking). */
const ANSWER_BLOCKS = new Set(["text", "tool_use", "server_tool_use"]);

type OpenCall = Omit<ModelCallTiming, "ttfbMs" | "firstTokenMs"> & {
  requestAt: number;
  openedAt: number;
  firstTokenAt?: number;
};

const count = (v: number | null | undefined, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * Turn one `query()`'s SDK messages into harness timings. Built right before
 * the query is spawned, so the init message measures the CLI's spawn-to-init
 * cost. The CLI's HTTP requests are invisible from here, so a request's start
 * is inferred: the init message for the first call, then the main thread's
 * tool-result message (or the previous response's end) for each next one. A
 * request the CLI retried internally reports its backoff inside `ttfbMs`.
 * Subagent streams (a parent tool id) are another context and are skipped.
 */
export function createClaudeCallTimer(
  now: () => number = () => performance.now(),
): (msg: SDKMessage) => HarnessTimingEvent[] {
  const spawnedAt = now();
  let initSeen = false;
  let requestAt = spawnedAt;
  let open: OpenCall | undefined;
  return (msg) => {
    if (msg.type === "system" && msg.subtype === "init") {
      requestAt = now();
      if (initSeen) return [];
      initSeen = true;
      return [{ type: "harness_init", ms: Math.round(requestAt - spawnedAt) }];
    }
    if (msg.type === "user" && msg.parent_tool_use_id === null) {
      requestAt = now();
      return [];
    }
    if (msg.type !== "stream_event" || msg.parent_tool_use_id !== null)
      return [];
    const ev = msg.event as StreamEventLike;
    if (ev.type === "message_start") {
      const u = ev.message?.usage ?? {};
      open = {
        provider: "anthropic",
        model: ev.message?.model ?? "",
        requestAt,
        openedAt: now(),
        inputTokens: count(u.input_tokens, 0),
        cacheReadTokens: count(u.cache_read_input_tokens, 0),
        cacheWriteTokens: count(u.cache_creation_input_tokens, 0),
        outputTokens: count(u.output_tokens, 0),
      };
    } else if (ev.type === "content_block_start" && open) {
      if (ANSWER_BLOCKS.has(ev.content_block?.type ?? ""))
        open.firstTokenAt ??= now();
    } else if (ev.type === "message_delta" && open && ev.usage) {
      // The delta's usage is cumulative for the response and may restate the
      // input split; a field it omits keeps the message_start value.
      open.inputTokens = count(ev.usage.input_tokens, open.inputTokens);
      open.cacheReadTokens = count(
        ev.usage.cache_read_input_tokens,
        open.cacheReadTokens,
      );
      open.cacheWriteTokens = count(
        ev.usage.cache_creation_input_tokens,
        open.cacheWriteTokens,
      );
      open.outputTokens = count(ev.usage.output_tokens, open.outputTokens);
    } else if (ev.type === "message_stop" && open) {
      const { requestAt: sent, openedAt, firstTokenAt, ...rest } = open;
      open = undefined;
      requestAt = now();
      return [
        {
          type: "call",
          call: {
            ...rest,
            ttfbMs: Math.max(0, Math.round(openedAt - sent)),
            ...(firstTokenAt !== undefined
              ? { firstTokenMs: Math.round(firstTokenAt - openedAt) }
              : {}),
          },
        },
      ];
    }
    return [];
  };
}
