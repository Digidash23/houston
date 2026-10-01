import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { isAutoContinueMessage } from "../src/lib/auto-continue-message.ts";
import {
  decodeGoalCard,
  decodeTeamCard,
  encodeGoalCard,
  encodeTeamCard,
} from "../src/lib/manager-onboarding/onboarding-card-markers.ts";

describe("team card marker", () => {
  it("round-trips what the manager can do, over the words the model reads", () => {
    const reach = { invite: true, connect: false };
    const content = encodeTeamCard({ reach }, "Your team is ready!");
    deepStrictEqual(decodeTeamCard(content), { reach });
    ok(content.endsWith("\n\nYour team is ready!"));
    deepStrictEqual(decodeTeamCard(encodeTeamCard({ reach: null }, "x")), {
      reach: null,
    });
  });

  it("leaves any other message as its words", () => {
    strictEqual(decodeTeamCard("Your team is ready!"), null);
    strictEqual(decodeTeamCard("<!--houston:onboarding-team nope-->"), null);
    strictEqual(
      decodeTeamCard('<!--houston:onboarding-team {"reach":{"invite":1}}-->'),
      null,
    );
  });
});

describe("goal card marker", () => {
  it("is the whole of the words the goal's message shows", () => {
    const text = encodeGoalCard({ goal: "Chase invoices" });
    deepStrictEqual(decodeGoalCard(text), { goal: "Chase invoices" });
    strictEqual(isAutoContinueMessage(text), false);
  });

  it("keeps a goal that would close the comment it rides in", () => {
    const goal = 'Reply --> "fast" <!-- always';
    const text = encodeGoalCard({ goal });
    deepStrictEqual(decodeGoalCard(text), { goal });
    strictEqual(text.split("-->").length, 2);
  });

  it("is not a message the person typed, nor a malformed card", () => {
    strictEqual(decodeGoalCard("Chase invoices"), null);
    strictEqual(decodeGoalCard("<!--houston:onboarding-goal {oops-->"), null);
    strictEqual(
      decodeGoalCard('<!--houston:onboarding-goal {"goal":1}-->'),
      null,
    );
  });
});
