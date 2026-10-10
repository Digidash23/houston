import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { FeedItem, HostCard } from "@houston-ai/chat";
import {
  browserHandoffCard,
  withBrowserHandoffCards,
} from "../src/lib/browser-handoff-feed.ts";
import {
  browserLiveViewState,
  createBrowserLiveFrames,
} from "../src/lib/browser-live-view-state.ts";

const user = (data: string): FeedItem => ({ feed_type: "user_message", data });
const call = (name: string, input: unknown, id?: string): FeedItem => ({
  feed_type: "tool_call",
  data: { name, input },
  ...(id ? { id } : {}),
});
const result = (name: string, content: string, is_error = false): FeedItem => ({
  feed_type: "tool_result",
  data: { name, content, is_error },
});
const handoff = (url?: string) => ({
  action: "handoff",
  text: "Sign in to your bank",
  ...(url ? { url } : {}),
});

function cardsIn(items: FeedItem[]): { at: number; card: HostCard }[] {
  return items.flatMap((item, at) =>
    item.feed_type === "host_card" ? [{ at, card: item.data }] : [],
  );
}

describe("browser hand-off cards in the feed", () => {
  it("sits right after the call while the hand-off waits, owning progress", () => {
    const items = [
      user("Check my bank"),
      call("browser", handoff("https://bank.example.com/login"), "c1"),
    ];
    const out = withBrowserHandoffCards(items, true, "chat-1");
    strictEqual(out.length, 3);
    const [{ at, card }] = cardsIn(out);
    strictEqual(at, 2);
    strictEqual(out[at].id, "c1:handoff");
    strictEqual(card.ownsProgress, true);
    const payload = browserHandoffCard(card);
    strictEqual(payload?.state, "waiting");
    strictEqual(payload?.site, "bank.example.com");
    strictEqual(payload?.conversationId, "chat-1");
    strictEqual(payload?.text, "Sign in to your bank");
  });

  it("moves after the result once answered and gives progress back", () => {
    const items = [
      user("Check my bank"),
      call("browser", handoff("https://bank.example.com/login")),
      result("browser", "The person finished"),
      { feed_type: "assistant_text", data: "Signed in." } as FeedItem,
    ];
    const out = withBrowserHandoffCards(items, true, "chat-1");
    const [{ at, card }] = cardsIn(out);
    strictEqual(out[at - 1].feed_type, "tool_result");
    strictEqual(card.ownsProgress, undefined);
    strictEqual(browserHandoffCard(card)?.state, "done");
  });

  it("reads the Claude (MCP-prefixed) tool name and the failure codes", () => {
    const name = "mcp__houston__browser";
    const items = [
      user("Go"),
      call(name, { action: "open", url: "https://www.shop.example.com/" }),
      result(name, "opened"),
      call(name, handoff()),
      result(name, "ERROR handoff_expired: Nobody finished", true),
    ];
    const [{ card }] = cardsIn(withBrowserHandoffCards(items, false, "c"));
    const payload = browserHandoffCard(card);
    strictEqual(payload?.state, "expired");
    strictEqual(payload?.site, "shop.example.com");
  });

  it("draws two hand-offs in one chat, each after its own result", () => {
    const items = [
      user("Do both"),
      call("browser", handoff("https://a.example.com"), "one"),
      result("browser", "ERROR handoff_cancelled: closed", true),
      user("Try again"),
      call("browser", handoff("https://b.example.com"), "two"),
    ];
    const out = withBrowserHandoffCards(items, true, "c");
    const cards = cardsIn(out).map(({ at, card }) => ({
      at,
      state: browserHandoffCard(card)?.state,
      site: browserHandoffCard(card)?.site,
    }));
    deepStrictEqual(cards, [
      { at: 3, state: "cancelled", site: "a.example.com" },
      { at: 6, state: "waiting", site: "b.example.com" },
    ]);
  });

  it("keeps waiting when the same message also called another tool", () => {
    const items = [
      user("Go"),
      call("browser", handoff("https://bank.example.com")),
      call("bash", { command: "ls" }),
    ];
    const [{ at, card }] = cardsIn(withBrowserHandoffCards(items, true, "c"));
    strictEqual(at, 2);
    strictEqual(browserHandoffCard(card)?.state, "waiting");
    strictEqual(card.ownsProgress, true);
  });

  it("reads a reloaded, interrupted hand-off (empty success) as ended", () => {
    const items = [
      user("Go"),
      call("browser", handoff()),
      result("browser", ""),
    ];
    const [{ card }] = cardsIn(withBrowserHandoffCards(items, false, "c"));
    strictEqual(browserHandoffCard(card)?.state, "ended");
  });

  it("leaves an unanswered hand-off as ended once no turn runs", () => {
    const items = [user("Go"), call("browser", handoff())];
    const [{ card }] = cardsIn(withBrowserHandoffCards(items, false, "c"));
    strictEqual(browserHandoffCard(card)?.state, "ended");
    strictEqual(card.ownsProgress, undefined);
  });

  it("leaves a feed without hand-offs alone and ignores other host cards", () => {
    const items = [
      user("Hi"),
      call("browser", { action: "click", ref: "s1e2" }),
    ];
    deepStrictEqual(withBrowserHandoffCards(items, true, "c"), items);
    strictEqual(browserHandoffCard({ kind: "onboarding", payload: {} }), null);
  });
});

describe("browser live view state", () => {
  it("maps the connection, ended reasons included", () => {
    strictEqual(browserLiveViewState({ kind: "connecting" }), "connecting");
    strictEqual(
      browserLiveViewState({ kind: "reconnecting", attempt: 2 }),
      "reconnecting",
    );
    strictEqual(
      browserLiveViewState({ kind: "ended", reason: "not_owner" }),
      "not_owner",
    );
    strictEqual(
      browserLiveViewState({ kind: "ended", reason: "done" }),
      "done",
    );
  });

  it("keeps the latest frame and stops a listener on unsubscribe", () => {
    const frames = createBrowserLiveFrames();
    const seen: number[] = [];
    const stop = frames.subscribe((frame) => seen.push(frame.seq));
    frames.push({ seq: 1, jpeg: "", width: 1, height: 1 });
    stop();
    frames.push({ seq: 2, jpeg: "", width: 1, height: 1 });
    deepStrictEqual(seen, [1]);
    strictEqual(frames.latest()?.seq, 2);
  });
});
