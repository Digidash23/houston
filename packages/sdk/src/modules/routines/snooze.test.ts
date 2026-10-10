import type { RoutineSnooze } from "@houston/protocol";
import { expect, test } from "vitest";
import { routineSnoozeNotice } from "./snooze";

const NOW = new Date("2026-10-09T12:00:00.000Z");
const snoozed: RoutineSnooze = {
  reason: "usage_limit",
  provider: "anthropic",
  model: "claude-fable-5",
  until: "2026-10-13T05:00:00.000Z",
  at: "2026-10-08T20:47:30.000Z",
};

test("a held routine reads as its provider, model and the instant fires resume", () => {
  expect(
    routineSnoozeNotice(
      { enabled: true, schedule: "*/5 * * * *", snoozed },
      NOW,
    ),
  ).toEqual({
    provider: "anthropic",
    model: "claude-fable-5",
    until: "2026-10-13T05:00:00.000Z",
    snoozedAt: "2026-10-08T20:47:30.000Z",
  });
});

test("no notice without a snooze, past its instant, or on a paused routine", () => {
  expect(
    routineSnoozeNotice({ enabled: true, schedule: "*/5 * * * *" }, NOW),
  ).toBeNull();
  expect(
    routineSnoozeNotice(
      { enabled: true, schedule: "*/5 * * * *", snoozed },
      new Date("2026-10-13T05:00:00.000Z"),
    ),
  ).toBeNull();
  expect(
    routineSnoozeNotice(
      { enabled: false, schedule: "*/5 * * * *", snoozed },
      NOW,
    ),
  ).toBeNull();
  expect(
    routineSnoozeNotice(
      {
        enabled: true,
        schedule: "*/5 * * * *",
        snoozed: { ...snoozed, until: "garbage" },
      },
      NOW,
    ),
  ).toBeNull();
});

test("a trigger routine is never shown as held: the snooze gates schedules only", () => {
  expect(routineSnoozeNotice({ enabled: true, snoozed }, NOW)).toBeNull();
});
