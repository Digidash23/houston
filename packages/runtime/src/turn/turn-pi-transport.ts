import type { Transport } from "@earendil-works/pi-ai";

/**
 * The provider transport of every pi session a pooled turn worker opens: the
 * turn's own agent session and its mission-title one-shot.
 *
 * pi's default, `auto`, opens a WebSocket first for a provider that has one
 * (in pi-ai 0.87 only `openai-codex`, the ChatGPT subscription) and caches it
 * per session for 5 minutes so the session's NEXT request skips the handshake.
 * A pooled worker never collects on that: a single-use sandbox exits after its
 * one turn, and a multi-turn worker takes its next turn from any conversation.
 * So `auto` only adds the handshake, and when Codex closes the socket (1011)
 * before the response starts, pi falls back to SSE only after that close: 6.4 s
 * of a 9.9 s time-to-first-token on a measured staging turn. Standing pods and
 * desktop keep `auto`, where the cached socket pays off across turns.
 */
export const POOLED_TURN_TRANSPORT: Transport = "sse";
