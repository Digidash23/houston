import { deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentActivitySummary } from "../src/components/shell/agent-activity-summary-model.ts";
import { agentRowLine } from "../src/components/shell/agent-row-line.ts";

const AGENT = { role: "Email assistant" };
const summary = (
  over: Partial<AgentActivitySummary>,
): AgentActivitySummary => ({
  needsYouCount: 0,
  runningCount: 0,
  headline: null,
  history: "unknown",
  ...over,
});

describe("an agent row's second line", () => {
  it("names the headline mission with its status", () => {
    const headline = {
      title: "Reply to Acme",
      updatedAt: "2026-09-26T09:00:00Z",
      status: "needs_you" as const,
    };
    deepStrictEqual(
      agentRowLine(AGENT, summary({ headline, history: "some" }), true),
      {
        kind: "mission",
        status: "needs_you",
        title: "Reply to Acme",
      },
    );
  });

  it("invites a confirmed first day", () => {
    deepStrictEqual(agentRowLine(AGENT, summary({ history: "none" }), true), {
      kind: "firstDay",
    });
  });

  it("keeps the role while the history is unconfirmed", () => {
    // A waking pod's empty list must not make a veteran read as brand new.
    deepStrictEqual(agentRowLine(AGENT, summary({}), true), {
      kind: "role",
      role: "Email assistant",
    });
  });

  it("never invites when the first day is not pending", () => {
    // Pending is decided by the caller: the employee's first day is pending
    // AND this caller may start it. Anything else would land on a board with
    // no start button.
    deepStrictEqual(agentRowLine(AGENT, summary({ history: "none" }), false), {
      kind: "role",
      role: "Email assistant",
    });
  });

  it("never invites someone the board would refuse", () => {
    deepStrictEqual(agentRowLine(AGENT, summary({ history: "none" }), false), {
      kind: "role",
      role: "Email assistant",
    });
  });

  it("says nothing for an unconfirmed employee with no role", () => {
    deepStrictEqual(agentRowLine({}, summary({}), true), { kind: "empty" });
  });
});
