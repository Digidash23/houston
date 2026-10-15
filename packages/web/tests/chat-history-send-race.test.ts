import { HoustonClient } from "@houston/engine-adapter/client";
import { conversationStore } from "@houston/engine-adapter/vm";
import type { ChatMessage } from "@houston/runtime-client";
import { conversationScope } from "@houston/sdk";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installLocalStorage, json } from "./support/wire-capture";

/**
 * A chat's history read racing the first message sent into it. The AI
 * Manager's chat opens and sends the person's goal at once, so its open read
 * can go out before the send and be answered with the transcript from before
 * it, yet reach the client only after the turn settled. That fold shares no
 * prompt with a feed holding nothing but the turn, which reads as a newer
 * server tail: it replaced the turn, and the goal card the person just sent
 * vanished (CI, onboarding-team-roster.spec.ts).
 */

const BASE = "http://host";
const AGENT = "a1";
const GOAL = "<!--houston:onboarding-goal {}-->";
const REPLY = "On it.";

/** What the runtime persists on every reply; its fold replays it as the
 *  turn's `final_result`, as the live turn's settle pushes one. */
const usage = { context_tokens: 1200, output_tokens: 80, cached_tokens: 0 };
const earlier: ChatMessage[] = [
  { role: "user", content: "earlier question", ts: 1, turnId: "t0" },
  { role: "assistant", content: "earlier answer", ts: 2, turnId: "t0", usage },
];
const withTurn: ChatMessage[] = [
  ...earlier,
  { role: "user", content: "hidden", displayText: GOAL, ts: 3, turnId: "t1" },
  { role: "assistant", content: REPLY, ts: 4, turnId: "t1", usage },
];

let seq = 0;
let sk: string;
let historyReads: string[];
/** The first history read, answered only when a spec says so. */
let answerFirstRead: (messages: ChatMessage[]) => void;

const chunk = (frames: object[]) =>
  new TextEncoder().encode(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
  );

/** The turn's stream: `sync` at once, the turn once the send named its nonce. */
const sse = (turn: (nonce: string) => object[], sent: Promise<string>) =>
  new Response(
    new ReadableStream({
      async start(controller) {
        controller.enqueue(
          chunk([
            { type: "sync", data: { running: false, partial: "", seq: 0 } },
          ]),
        );
        controller.enqueue(chunk(turn(await sent)));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

beforeEach(() => {
  installLocalStorage();
  sk = `send-race-${seq++}`;
  historyReads = [];
  let send: (nonce: string) => void = () => {};
  const sent = new Promise<string>((resolve) => {
    send = resolve;
  });
  const firstRead = new Promise<Response>((resolve) => {
    answerFirstRead = (messages) =>
      resolve(json(200, { id: sk, title: "", messages }));
  });
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/messages?")) {
      historyReads.push(url);
      return historyReads.length === 1
        ? firstRead
        : json(200, { id: sk, title: "", messages: withTurn });
    }
    if (init?.method === "POST" && url.endsWith("/messages")) {
      send((JSON.parse(String(init.body)) as { nonce: string }).nonce);
      return json(202, { ok: true, id: sk, turnId: "t1" });
    }
    if (url.endsWith("/events"))
      return sse(
        (nonce) => [
          {
            type: "user",
            data: { content: "hidden", ts: 3, nonce },
            turnId: "t1",
            seq: 1,
          },
          { type: "text", data: REPLY, turnId: "t1", seq: 2 },
          { type: "done", data: null, turnId: "t1", seq: 3 },
        ],
        sent,
      );
    return json(200, { ok: true, items: [] });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const client = () =>
  new HoustonClient({ baseUrl: BASE, token: "t", controlPlane: true });

function vm() {
  return conversationStore.getSnapshot(conversationScope(AGENT, sk)) as
    | { running: boolean; feed: { feed_type: string; data: unknown }[] }
    | undefined;
}
const feed = () => (vm()?.feed ?? []).map((f) => [f.feed_type, f.data]);

/** Open the chat, then send into it while the open read is still out. */
async function sendOverTheOpenRead(c: HoustonClient) {
  const open = c.loadChatHistory(AGENT, sk);
  await vi.waitUntil(() => historyReads.length === 1);
  const started = c.startSession(AGENT, {
    sessionKey: sk,
    prompt: "hidden",
    displayText: GOAL,
  });
  await started;
  await vi.waitUntil(
    () => vm()?.running === false && feed().some(([, d]) => d === REPLY),
  );
  // Wrapped: an async function returning the read itself would wait on it.
  return { open };
}

test("a read that went out before the send never replaces the turn it missed", async () => {
  const { open } = await sendOverTheOpenRead(client());

  answerFirstRead(earlier);
  await open;

  expect(feed()).toContainEqual(["user_message", GOAL]);
  expect(feed()).toContainEqual(["assistant_text", REPLY]);
  expect(feed()).not.toContainEqual(["user_message", "earlier question"]);
});

test("a read asked for after the send goes out fresh instead of joining the older one", async () => {
  const c = client();
  const { open } = await sendOverTheOpenRead(c);

  // The turn's ConversationsChanged asks the open chat to read again.
  await c.loadChatHistory(AGENT, sk);
  expect(historyReads).toHaveLength(2);
  answerFirstRead(earlier);
  await open;

  expect(feed().filter(([type]) => type !== "final_result")).toEqual([
    ["user_message", "earlier question"],
    ["assistant_text", "earlier answer"],
    ["user_message", GOAL],
    ["assistant_text", REPLY],
  ]);
});
