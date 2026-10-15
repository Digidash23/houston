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
 *
 * The app reaches this read once: the chat-history query's first fetch joins
 * every change event that lands while it is out. So each spec below makes
 * ONE `loadChatHistory` call, and that call must end with the whole
 * conversation seeded.
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
let historyReads: number;
/** The first history read, answered only when a spec says so. */
let answerFirstRead: (messages: ChatMessage[]) => void;
/** Ends the turn: its stream sends `done`. */
let finishTurn: () => void;
/** Makes the host refuse every send, before it persists the prompt. */
let refuseSends: () => void;
/** Holds the host's answer to the next send until the returned call. */
let holdSends: () => () => void;

const chunk = (frames: object[]) =>
  new TextEncoder().encode(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
  );

/** The turn's stream: `sync` at once, the prompt's echo and the reply once
 *  the send named its nonce, `done` once the spec ends the turn. */
const sse = (sent: Promise<string>, done: Promise<void>) =>
  new Response(
    new ReadableStream({
      async start(controller) {
        controller.enqueue(
          chunk([
            { type: "sync", data: { running: false, partial: "", seq: 0 } },
          ]),
        );
        const nonce = await sent;
        controller.enqueue(
          chunk([
            {
              type: "user",
              data: { content: "hidden", ts: 3, nonce },
              turnId: "t1",
              seq: 1,
            },
            { type: "text", data: REPLY, turnId: "t1", seq: 2 },
          ]),
        );
        await done;
        controller.enqueue(
          chunk([{ type: "done", data: null, turnId: "t1", seq: 3 }]),
        );
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  installLocalStorage();
  sk = `send-race-${seq++}`;
  historyReads = 0;
  const firstRead = deferred<ChatMessage[]>();
  answerFirstRead = firstRead.resolve;
  const sent = deferred<string>();
  const done = deferred<void>();
  finishTurn = () => done.resolve();
  let refusing = false;
  refuseSends = () => {
    refusing = true;
  };
  let accepted: Promise<void> = Promise.resolve();
  holdSends = () => {
    const gate = deferred<void>();
    accepted = gate.promise;
    return () => gate.resolve();
  };
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/messages?")) {
      historyReads++;
      const messages = historyReads === 1 ? await firstRead.promise : withTurn;
      return json(200, { id: sk, title: "", messages });
    }
    if (init?.method === "POST" && url.endsWith("/messages")) {
      if (refusing) return json(400, { error: "message too long" });
      await accepted;
      sent.resolve((JSON.parse(String(init.body)) as { nonce: string }).nonce);
      return json(202, { ok: true, id: sk, turnId: "t1" });
    }
    if (url.endsWith("/events")) return sse(sent.promise, done.promise);
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
    | {
        running: boolean;
        feed: { feed_type: string; data: unknown }[];
        historyWindow?: { earliestLoaded: number; total: number };
      }
    | undefined;
}
const feed = () =>
  (vm()?.feed ?? [])
    .filter((f) => f.feed_type !== "final_result")
    .map((f) => [f.feed_type, f.data]);
const whole = [
  ["user_message", "earlier question"],
  ["assistant_text", "earlier answer"],
  ["user_message", GOAL],
  ["assistant_text", REPLY],
];

const send = (c: HoustonClient) =>
  c.startSession(AGENT, {
    sessionKey: sk,
    prompt: "hidden",
    displayText: GOAL,
  });
const replied = () => vi.waitUntil(() => feed().some(([, d]) => d === REPLY));
const settled = () => vi.waitUntil(() => vm()?.running === false);

test("an open read a send overtook reads again once the turn settles", async () => {
  const c = client();
  const open = c.loadChatHistory(AGENT, sk);
  await vi.waitUntil(() => historyReads === 1);
  await send(c);
  await replied();

  answerFirstRead(earlier); // the transcript from before the send
  await new Promise((r) => setTimeout(r, 20));
  expect(historyReads).toBe(1); // the turn still holds the chat
  finishTurn();
  await open;

  expect(historyReads).toBe(2);
  expect(feed()).toEqual(whole);
  // Stamped, so the chat knows where the server transcript starts.
  expect(vm()?.historyWindow).toEqual({ earliestLoaded: 0, total: 4 });
});

test("an open read answered after the turn settled reads again at once", async () => {
  const c = client();
  const open = c.loadChatHistory(AGENT, sk);
  await vi.waitUntil(() => historyReads === 1);
  await send(c);
  finishTurn();
  await settled();

  answerFirstRead(earlier);
  await open;

  expect(historyReads).toBe(2);
  expect(feed()).toEqual(whole);
});

test("a read sent before the host took the send waits the turn out", async () => {
  // Out after the send started but before its 202: the answer may predate
  // the prompt, so only a read after the turn is trusted.
  const accept = holdSends();
  const c = client();
  void send(c);
  const open = c.loadChatHistory(AGENT, sk);
  await vi.waitUntil(() => historyReads === 1);
  answerFirstRead(earlier);
  accept();
  await replied();
  expect(historyReads).toBe(1);
  finishTurn();
  await open;

  expect(historyReads).toBe(2);
  expect(feed()).toEqual(whole);
});

test("after a refused send, the next read is the server's transcript", async () => {
  // The host never took the prompt, so it is in no read to come: holding the
  // feed for it would keep the chat from its history for good.
  refuseSends();
  const c = client();
  await send(c);
  await settled();

  const open = c.loadChatHistory(AGENT, sk);
  await vi.waitUntil(() => historyReads === 1);
  answerFirstRead(earlier);
  await open;

  expect(historyReads).toBe(1);
  expect(feed()).toEqual([
    ["user_message", "earlier question"],
    ["assistant_text", "earlier answer"],
  ]);
});
