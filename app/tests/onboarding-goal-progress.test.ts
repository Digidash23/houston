import { deepStrictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { FeedItem } from "@houston-ai/chat";
import { goalProgress } from "../src/lib/manager-onboarding/goal-progress.ts";

const MISSION = { id: "m1", title: "Chase invoices", agent: "cfo" };

const hire = (name: string): FeedItem => ({
  feed_type: "tool_call",
  data: {
    name: "houston_call",
    input: { operation: "createAgent", params: { name, color: "golden" } },
  },
});
const lookup: FeedItem = {
  feed_type: "tool_call",
  data: { name: "houston_describe", input: { operation: "createAgent" } },
};
const result = (name: string, isError = false): FeedItem => ({
  feed_type: "tool_result",
  data: { name, content: isError ? "name_taken" : "ok", is_error: isError },
});
const startMission = (agent?: string): FeedItem => ({
  feed_type: "tool_call",
  data: { name: "start_mission", input: agent ? { agent } : {} },
});
const started: FeedItem = {
  feed_type: "tool_result",
  data: {
    name: "start_mission",
    content: "started",
    is_error: false,
    mission: MISSION,
  },
};
const settled: FeedItem = {
  feed_type: "final_result",
  data: { result: "", cost_usd: null, duration_ms: null },
};

describe("goalProgress", () => {
  it("finds the right person until the manager names a hire", () => {
    deepStrictEqual(goalProgress([]), { phase: "staffing", hiring: null });
    deepStrictEqual(goalProgress([lookup, result("houston_describe")]), {
      phase: "staffing",
      hiring: null,
    });
    deepStrictEqual(goalProgress([hire("Chief of Finance")]), {
      phase: "staffing",
      hiring: "Chief of Finance",
    });
  });

  it("assigns once the hire lands, and runs once the mission starts", () => {
    const hired = [hire("Chief of Finance"), result("houston_call")];
    deepStrictEqual(goalProgress(hired), {
      phase: "assigning",
      staff: { kind: "hired", name: "Chief of Finance" },
    });
    deepStrictEqual(goalProgress([...hired, startMission("cfo"), started]), {
      phase: "started",
      staff: { kind: "hired", name: "Chief of Finance" },
      mission: MISSION,
    });
  });

  it("counts a hire retried under another name once it lands", () => {
    const items = [
      hire("Chief of Finance"),
      result("houston_call", true),
      hire("Finance Lead"),
    ];
    deepStrictEqual(goalProgress(items), {
      phase: "staffing",
      hiring: "Finance Lead",
    });
    deepStrictEqual(goalProgress([...items, result("houston_call")]), {
      phase: "assigning",
      staff: { kind: "hired", name: "Finance Lead" },
    });
  });

  it("picks someone already on the team when no hire is made", () => {
    deepStrictEqual(goalProgress([startMission("Ava")]), {
      phase: "assigning",
      staff: { kind: "picked", agent: "Ava" },
    });
    deepStrictEqual(goalProgress([startMission("Ava"), started]), {
      phase: "started",
      staff: { kind: "picked", agent: "cfo" },
      mission: MISSION,
    });
  });

  it("fails only when the turn ends with no mission, in the manager's words", () => {
    const said: FeedItem = {
      feed_type: "assistant_text",
      data: " I couldn't hire anyone right now. ",
    };
    const items = [hire("Chief of Finance"), result("houston_call", true)];
    deepStrictEqual(goalProgress(items), {
      phase: "staffing",
      hiring: "Chief of Finance",
    });
    deepStrictEqual(goalProgress([...items, said, settled]), {
      phase: "failed",
      staff: null,
      reason: "I couldn't hire anyone right now.",
    });
    deepStrictEqual(
      goalProgress([hire("CFO"), result("houston_call"), settled]),
      { phase: "failed", staff: { kind: "hired", name: "CFO" }, reason: null },
    );
  });

  it("ends with the person's next message too", () => {
    const next: FeedItem = { feed_type: "user_message", data: "hello?" };
    deepStrictEqual(goalProgress([next]), {
      phase: "failed",
      staff: null,
      reason: null,
    });
  });
});

describe("goalProgress on the Claude backend", () => {
  it("reads its namespaced houston_call as the hire", () => {
    const call: FeedItem = {
      feed_type: "tool_call",
      data: {
        name: "mcp__houston__houston_call",
        input: { operation: "createAgent", params: { name: "CFO" } },
      },
    };
    const ok: FeedItem = {
      feed_type: "tool_result",
      data: {
        name: "mcp__houston__houston_call",
        content: "{}",
        is_error: false,
      },
    };
    deepStrictEqual(goalProgress([call, ok]), {
      phase: "assigning",
      staff: { kind: "hired", name: "CFO" },
    });
  });
});

describe("goalProgress when the turn fails before the manager answers", () => {
  it("fails on the chat's error line, and not on a restart notice", () => {
    const lost: FeedItem = {
      feed_type: "system_message",
      data: "Could not reach the app",
    };
    deepStrictEqual(goalProgress([lost]), {
      phase: "failed",
      staff: null,
      reason: null,
    });
    const restarted: FeedItem = {
      feed_type: "system_message",
      data: "Restarted",
      notice: "engine_restart",
    };
    deepStrictEqual(goalProgress([restarted]), {
      phase: "staffing",
      hiring: null,
    });
  });

  it("fails on a send the shared compute never had room for", () => {
    const busy: FeedItem = {
      feed_type: "system_message",
      data: "It's too busy right now to start your message.",
      notice: "compute_busy",
    };
    deepStrictEqual(goalProgress([busy]), {
      phase: "failed",
      staff: null,
      reason: null,
    });
  });

  it("fails on a turn that could not get ready to start", () => {
    for (const notice of ["agent_too_large", "agent_setup_failed"] as const) {
      const setup: FeedItem = {
        feed_type: "system_message",
        data: "Your agent couldn't get ready for this message.",
        notice,
      };
      deepStrictEqual(goalProgress([setup]), {
        phase: "failed",
        staff: null,
        reason: null,
      });
    }
  });
});
