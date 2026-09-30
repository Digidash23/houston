import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { FeedItem, HostCard } from "@houston-ai/chat";
import {
  encodeGoalCard,
  encodeTeamCard,
} from "../src/lib/manager-onboarding/onboarding-card-markers.ts";
import {
  type OnboardingCard,
  onboardingCard,
  teamCardItem,
  withOnboardingCards,
} from "../src/lib/manager-onboarding/onboarding-feed.ts";

const REACH = { invite: false, connect: true };
const say = (data: string, id?: string): FeedItem => ({
  feed_type: "assistant_text",
  data,
  ...(id ? { id } : {}),
});
const kickoff = (goal: string, id: string): FeedItem => ({
  feed_type: "user_message",
  id,
  data: encodeGoalCard({ goal }),
});
const hireCall: FeedItem = {
  feed_type: "tool_call",
  data: {
    name: "houston_call",
    input: { operation: "createAgent", params: { name: "Chief of Finance" } },
  },
};
const settled: FeedItem = {
  feed_type: "final_result",
  data: { result: "", cost_usd: null, duration_ms: null },
};

function cards(items: FeedItem[]): (OnboardingCard | FeedItem["feed_type"])[] {
  return items.map((item) =>
    item.feed_type === "host_card"
      ? (onboardingCard(item.data) ?? "host_card")
      : item.feed_type,
  );
}

describe("withOnboardingCards", () => {
  it("draws the closing as the team card and leaves other messages alone", () => {
    const items = [
      say("Hi!"),
      say(encodeTeamCard({ reach: REACH }, "Your team is ready!"), "a1"),
    ];
    const out = withOnboardingCards(items);
    deepStrictEqual(cards(out), [
      "assistant_text",
      { kind: "team", team: { reach: REACH } },
    ]);
    strictEqual(out[1].id, "a1");
    deepStrictEqual(out[1], teamCardItem("a1", { reach: REACH }));
  });

  it("draws the goal's whole turn as one goal card that shows its own progress", () => {
    const out = withOnboardingCards([
      kickoff("Chase invoices", "u1"),
      say("First, I'll hire someone."),
      hireCall,
    ]);
    deepStrictEqual(cards(out), [
      {
        kind: "goal",
        goal: "Chase invoices",
        progress: { phase: "staffing", hiring: "Chief of Finance" },
      },
    ]);
    const card = out[0].feed_type === "host_card" ? out[0].data : null;
    strictEqual((card as HostCard).ownsProgress, true);
    strictEqual(out[0].id, "u1");
  });

  it("keeps the settle frame and a provider failure under the goal card, then what follows", () => {
    const failure: FeedItem = {
      feed_type: "provider_error",
      data: { kind: "network_unreachable", provider: "anthropic", message: "" },
    };
    const next: FeedItem = { feed_type: "user_message", data: "Thanks!" };
    deepStrictEqual(
      cards(
        withOnboardingCards([
          kickoff("Chase invoices", "u1"),
          say("Sorry."),
          failure,
          settled,
          next,
          say("Anytime."),
        ]),
      ),
      [
        {
          kind: "goal",
          goal: "Chase invoices",
          progress: { phase: "failed", staff: null, reason: "Sorry." },
        },
        "provider_error",
        "final_result",
        "user_message",
        "assistant_text",
      ],
    );
  });

  it("shows only the latest attempt when the goal was tried again", () => {
    const out = withOnboardingCards([
      kickoff("Chase invoices", "u1"),
      say("I couldn't."),
      settled,
      kickoff("Chase invoices", "u2"),
      hireCall,
    ]);
    strictEqual(out.length, 1);
    strictEqual(out[0].id, "u2");
  });

  it("leaves any other message, hidden or typed, as it is", () => {
    const hidden: FeedItem = {
      feed_type: "user_message",
      data: "<!--houston:auto_continue-->\n\nGo on.",
    };
    deepStrictEqual(withOnboardingCards([hidden, say("Done.")]), [
      hidden,
      say("Done."),
    ]);
  });
});

describe("onboardingCard", () => {
  it("ignores host cards that are not onboarding's", () => {
    strictEqual(onboardingCard({ kind: "other", payload: {} }), null);
  });
});

describe("withOnboardingCards when the goal's send fails", () => {
  it("keeps the chat's error line under the goal card", () => {
    const lost: FeedItem = {
      feed_type: "system_message",
      data: "Could not reach the app",
    };
    deepStrictEqual(
      cards(withOnboardingCards([kickoff("Chase invoices", "u1"), lost])),
      [
        {
          kind: "goal",
          goal: "Chase invoices",
          progress: { phase: "failed", staff: null, reason: null },
        },
        "system_message",
      ],
    );
  });
});
