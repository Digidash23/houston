import type { Message, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type {
  AgentSession,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { ModelCallTiming } from "@houston/protocol";
import type {
  ForcedToolCall,
  ForcedToolCallRequest,
} from "../forced-tool-call";
import type { ForcingPlan } from "./forced-tool-choice";

type StreamFn = AgentSession["agent"]["streamFunction"];
type AgentMessage = AgentSession["messages"][number];

/** A model request exactly as pi's agent loop sent it. */
export interface SentRequest {
  model: Parameters<StreamFn>[0];
  context: Parameters<StreamFn>[1];
  options: Parameters<StreamFn>[2];
}

/**
 * Report every request the agent loop sends. The forced call extends the
 * LAST one byte-for-byte (same system message, tool declarations, history,
 * session id), so the provider's prompt cache still covers the whole turn.
 *
 * pi routes its own summaries (threshold/overflow compaction, which can run
 * inside a prompt right after the final reply) through the same stream
 * function with no session id; only requests carrying the session's id are
 * the conversation's, so a summary never becomes the request to extend.
 */
export function captureSentRequests(
  session: AgentSession,
  onSend: (sent: SentRequest) => void,
): void {
  // Stub sessions in unit tests carry no agent.
  const agent: AgentSession["agent"] | undefined = session.agent;
  if (!agent) return;
  const send = agent.streamFunction;
  agent.streamFunction = (model, context, options) => {
    if (
      options?.sessionId !== undefined &&
      options.sessionId === session.sessionId
    )
      onSend({ model, context, options });
    return send(model, context, options);
  };
}

/**
 * What the model produced in answer to the last request: its final assistant
 * message plus any tool results after it (an offer tool that ended the turn).
 * Every request yields exactly one assistant message, so the newest one IS
 * that answer. Null when the turn did not end on a usable reply.
 */
export function replyAfterLastRequest(
  messages: readonly AgentMessage[],
): Message[] | null {
  const last = messages.findLastIndex(
    (m) => "role" in m && m.role === "assistant",
  );
  const reply = messages[last];
  if (!reply || !("role" in reply) || reply.role !== "assistant") return null;
  if (reply.stopReason !== "stop" && reply.stopReason !== "toolUse")
    return null;
  return messages
    .slice(last)
    .filter(
      (m): m is Message =>
        "role" in m && (m.role === "assistant" || m.role === "toolResult"),
    );
}

/** Run the forced request and read the named tool's arguments off it. */
export async function runForcedToolCall(input: {
  runtime: Pick<ModelRuntime, "streamSimple">;
  sent: SentRequest;
  /** The model's forced form (forced-tool-choice.ts); only forced runs. */
  plan: Extract<ForcingPlan, { kind: "forced" }>;
  reply: Message[];
  request: ForcedToolCallRequest;
  now?: () => number;
}): Promise<{ result: ForcedToolCall; call: ModelCallTiming | null }> {
  const { sent, plan, request } = input;
  const now = input.now ?? (() => performance.now());
  const options: SimpleStreamOptions = {
    ...sent.options,
    signal: request.signal,
    maxRetries: 0,
    reasoning: plan.reasoning,
    // Codex's websocket keeps ONE continuation per session (the last request
    // and its answer) and sends the next request as a delta on top of it. This
    // request differs from the turn's (tool choice, effort), so over the
    // socket it would replace that continuation, and an abort would close the
    // socket: the user's next turn would reconnect and resend its whole
    // input. Over SSE the turn's continuation stays as the next turn needs it.
    transport: "sse",
    // SAFETY: the neutral type lists auto/none only; each API module forwards
    // its own native forced form (forced-tool-choice.ts) verbatim.
    toolChoice: plan.toolChoice as SimpleStreamOptions["toolChoice"],
  };
  const messages: Message[] = [
    ...sent.context.messages,
    ...input.reply,
    { role: "user", content: request.instruction, timestamp: Date.now() },
  ];
  const requestAt = now();
  let openedAt: number | undefined;
  let firstTokenAt: number | undefined;
  const stream = input.runtime.streamSimple(sent.model, { messages }, options);
  for await (const event of stream) {
    if (event.type === "start") openedAt ??= now();
    else if (event.type === "toolcall_start" || event.type === "text_start")
      firstTokenAt ??= now();
  }
  const message = await stream.result();
  if (message.stopReason === "error" || message.stopReason === "aborted")
    throw new Error(message.errorMessage || `request ${message.stopReason}`);
  const call: ModelCallTiming | null =
    openedAt === undefined
      ? null
      : {
          provider: message.provider,
          model: message.model,
          ttfbMs: Math.max(0, Math.round(openedAt - requestAt)),
          ...(firstTokenAt !== undefined
            ? { firstTokenMs: Math.round(firstTokenAt - openedAt) }
            : {}),
          inputTokens: message.usage?.input ?? 0,
          cacheReadTokens: message.usage?.cacheRead ?? 0,
          cacheWriteTokens: message.usage?.cacheWrite ?? 0,
          outputTokens: message.usage?.output ?? 0,
        };
  const toolCall = message.content.find(
    (block) => block.type === "toolCall" && block.name === request.toolName,
  );
  const result: ForcedToolCall =
    toolCall?.type === "toolCall"
      ? { outcome: "called", args: toolCall.arguments }
      : { outcome: "not_called" };
  return { result, call };
}
