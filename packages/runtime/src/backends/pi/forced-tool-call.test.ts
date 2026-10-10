import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Message,
  SimpleStreamOptions,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type {
  AgentSession,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import {
  captureSentRequests,
  replyAfterLastRequest,
  runForcedToolCall,
  type SentRequest,
} from "./forced-tool-call";

/**
 * The pi half of the follow-up safety net: the forced request extends the
 * turn's last request with its reply and a hidden instruction, forces the
 * tool in each provider's native form, and reads the call's arguments off
 * the answer without running anything.
 */

const USAGE = {
  input: 40,
  output: 25,
  cacheRead: 9_000,
  cacheWrite: 0,
  totalTokens: 9_065,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(over: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "Done." }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    usage: USAGE,
    stopReason: "stop",
    timestamp: 0,
    ...over,
  };
}

const SYSTEM: Message = {
  role: "system",
  content: "You are Houston.",
  timestamp: 0,
};
const USER: Message = { role: "user", content: "hola", timestamp: 0 };

const CODEX_PLAN = {
  kind: "forced",
  toolChoice: "required",
  reasoning: "minimal",
} as const;

function sent(api: string): SentRequest {
  // SAFETY: a fixture; only the model's api and the context are read.
  return {
    model: { api, provider: "openai-codex", id: "gpt-5.6-sol" },
    context: { messages: [SYSTEM, USER] },
    options: { sessionId: "s-1", reasoning: "high" },
  } as unknown as SentRequest;
}

/** A runtime answering every request with `answer`, recording the request. */
function runtime(answer: AssistantMessage) {
  const seen: {
    context: { messages: Message[] };
    options: SimpleStreamOptions;
  }[] = [];
  const fake = {
    streamSimple(
      _model: unknown,
      context: { messages: Message[] },
      options: SimpleStreamOptions,
    ) {
      seen.push({ context, options });
      const stream = {
        async *[Symbol.asyncIterator]() {
          yield { type: "start", partial: answer };
          yield { type: "toolcall_start", contentIndex: 0, partial: answer };
        },
        result: async () => answer,
      };
      return stream as unknown as AssistantMessageEventStream;
    },
  };
  return { seen, fake: fake as unknown as Pick<ModelRuntime, "streamSimple"> };
}

const ACTIONS = {
  actions: [
    { id: "a", label: "Otra", message: "Haz otra" },
    { id: "b", label: "Ajusta", message: "Ajústalo" },
  ],
};
const CALLED = assistant({
  content: [
    { type: "toolCall", id: "c1", name: "suggest_actions", arguments: ACTIONS },
  ],
  stopReason: "toolUse",
});

function request() {
  return {
    toolName: "suggest_actions",
    instruction: "call it",
    signal: new AbortController().signal,
  };
}

test("extends the last request with the reply and the hidden instruction, forced on Codex", async () => {
  const { seen, fake } = runtime(CALLED);
  const reply = [assistant()];
  let t = 0;
  const { result, call } = await runForcedToolCall({
    runtime: fake,
    sent: sent("openai-codex-responses"),
    plan: CODEX_PLAN,
    reply,
    request: request(),
    now: () => (t += 100),
  });
  expect(result).toEqual({ outcome: "called", args: ACTIONS });
  const messages = seen[0]?.context.messages ?? [];
  expect(messages.slice(0, 3)).toEqual([SYSTEM, USER, reply[0]]);
  expect(messages[3]).toMatchObject({ role: "user", content: "call it" });
  expect(seen[0]?.options).toMatchObject({
    sessionId: "s-1",
    toolChoice: "required",
    reasoning: "minimal",
    maxRetries: 0,
    // Off the session's websocket, whose continuation the next turn extends.
    transport: "sse",
  });
  expect(call).toMatchObject({
    provider: "openai-codex",
    ttfbMs: 100,
    firstTokenMs: 100,
    cacheReadTokens: 9_000,
    outputTokens: 25,
  });
});

test("an answer without the tool call is not_called; an errored one throws", async () => {
  const text = runtime(assistant());
  const { result } = await runForcedToolCall({
    runtime: text.fake,
    sent: sent("openai-codex-responses"),
    plan: CODEX_PLAN,
    reply: [],
    request: request(),
  });
  expect(result).toEqual({ outcome: "not_called" });
  const failed = runtime(
    assistant({ stopReason: "error", errorMessage: "429 slow down" }),
  );
  await expect(
    runForcedToolCall({
      runtime: failed.fake,
      sent: sent("openai-codex-responses"),
      plan: CODEX_PLAN,
      reply: [],
      request: request(),
    }),
  ).rejects.toThrow("429 slow down");
});

test("the reply is the newest assistant message plus the tool results after it", () => {
  const offer = assistant({ stopReason: "toolUse" });
  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: "r1",
    toolName: "suggest_reusable",
    content: [{ type: "text", text: "ok" }],
    isError: false,
    timestamp: 0,
  };
  const earlier = assistant({ content: [{ type: "text", text: "old" }] });
  type Messages = AgentSession["messages"];
  expect(
    replyAfterLastRequest([USER, earlier, USER, offer, toolResult] as Messages),
  ).toEqual([offer, toolResult]);
  expect(replyAfterLastRequest([USER] as Messages)).toBeNull();
  expect(
    replyAfterLastRequest([
      USER,
      assistant({ stopReason: "length" }),
    ] as Messages),
  ).toBeNull();
});

test("the session's requests are reported and sent unchanged; pi's own summaries are not reported", () => {
  const calls: unknown[] = [];
  const agent = {
    streamFunction: (...args: unknown[]) => {
      calls.push(args);
      return "stream";
    },
  };
  const reported: SentRequest[] = [];
  captureSentRequests(
    { agent, sessionId: "x" } as unknown as AgentSession,
    (s) => reported.push(s),
  );
  const send = agent.streamFunction as (...args: unknown[]) => unknown;
  expect(send("m", { messages: [] }, { sessionId: "x" })).toBe("stream");
  // Compaction runs through the same stream function with no session id,
  // possibly right after the turn's final reply.
  expect(send("m", { messages: [USER] }, {})).toBe("stream");
  expect(calls).toEqual([
    ["m", { messages: [] }, { sessionId: "x" }],
    ["m", { messages: [USER] }, {}],
  ]);
  expect(reported).toEqual([
    { model: "m", context: { messages: [] }, options: { sessionId: "x" } },
  ]);
});
