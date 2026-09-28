import type { Activity } from "@houston/wire-types";
import { expect, test } from "vitest";
import { activityToConversation } from "./activities";

const activity = {
  id: "mission-1",
  title: "Draft a summary",
  description: "Brief summary",
  status: "running",
  session_key: "activity-mission-1",
  updated_at: "2026-09-27T00:00:00.000Z",
  origin_session_key: "activity-parent",
  origin_agent: "Personal/Scout",
} as Activity;

test("activityToConversation preserves the starting agent", () => {
  const conversation = activityToConversation(
    activity,
    "Personal/Writer",
    "Writer",
  );
  expect(conversation.origin_agent).toBe("Personal/Scout");
  expect(conversation.origin_session_key).toBe("activity-parent");
});

test("activityToConversation leaves absent provenance absent", () => {
  const conversation = activityToConversation(
    { ...activity, origin_agent: undefined },
    "Personal/Writer",
    "Writer",
  );
  expect(conversation).not.toHaveProperty("origin_agent");
});
