import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { UPDATE_CHECK_INTERVAL_MS } from "../src/lib/update-policy.ts";
import {
  type AbsenceEvent,
  type AbsenceState,
  absenceStep,
  draftPending,
  initialAbsence,
  LONG_ABSENCE_MS,
  returnAction,
  SLEEP_GAP_MS,
} from "../src/lib/update-return.ts";
import type { UpdateStatus } from "../src/lib/update-status.ts";

const HOUR = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

/** Feed events the way the hook does: one ref, one step per event, and the
 *  list of events that reported a return. */
function run(start: AbsenceState, events: AbsenceEvent[]): number[] {
  let state = start;
  const returns: number[] = [];
  events.forEach((event, index) => {
    const step = absenceStep(state, event);
    state = step.state;
    if (step.returned) returns.push(index);
  });
  return returns;
}

describe("absenceStep", () => {
  it("treats a short blur as nothing", () => {
    deepStrictEqual(
      run(initialAbsence(T0), [
        { kind: "away", at: T0 + 1_000 },
        { kind: "back", at: T0 + 20 * 60 * 1000 },
      ]),
      [],
    );
  });

  it("reports a return once after a hide of the threshold or longer", () => {
    deepStrictEqual(
      run(initialAbsence(T0), [
        { kind: "away", at: T0 },
        { kind: "back", at: T0 + LONG_ABSENCE_MS },
        // Focus and visibility both fire on the way back: one return.
        { kind: "back", at: T0 + LONG_ABSENCE_MS + 10 },
      ]),
      [1],
    );
  });

  it("keeps the first goodbye's clock when a hide follows a blur", () => {
    deepStrictEqual(
      run(initialAbsence(T0), [
        { kind: "away", at: T0 },
        { kind: "away", at: T0 + 3 * HOUR },
        { kind: "back", at: T0 + 4 * HOUR },
      ]),
      [2],
    );
  });

  it("reports a return when the interval tick lands after a sleep", () => {
    const onTime = T0 + UPDATE_CHECK_INTERVAL_MS + 2_000;
    deepStrictEqual(
      run(initialAbsence(T0), [
        { kind: "tick", at: onTime },
        { kind: "tick", at: onTime + UPDATE_CHECK_INTERVAL_MS + SLEEP_GAP_MS },
      ]),
      [1],
    );
  });

  it("holds a sleep seen while away until the person is back", () => {
    deepStrictEqual(
      run(initialAbsence(T0), [
        { kind: "away", at: T0 + 1_000 },
        { kind: "tick", at: T0 + UPDATE_CHECK_INTERVAL_MS + SLEEP_GAP_MS },
        { kind: "back", at: T0 + UPDATE_CHECK_INTERVAL_MS + SLEEP_GAP_MS + 5 },
      ]),
      [2],
    );
  });

  it("ignores a tick that is merely late, not asleep", () => {
    deepStrictEqual(
      run(initialAbsence(T0), [
        { kind: "tick", at: T0 + UPDATE_CHECK_INTERVAL_MS + SLEEP_GAP_MS - 1 },
      ]),
      [],
    );
  });

  // The hook is remounted with <App/> on every identity change. A new mount
  // starts in front with no absence behind it, so its first focus, even
  // hours after the process started, and its first tick arm nothing.
  it("arms nothing on a remount", () => {
    const mountedAt = T0 + 9 * HOUR;
    deepStrictEqual(
      run(initialAbsence(mountedAt), [
        { kind: "back", at: mountedAt + 1 },
        { kind: "tick", at: mountedAt + UPDATE_CHECK_INTERVAL_MS },
      ]),
      [],
    );
  });

  it("starts a fresh absence after a return", () => {
    deepStrictEqual(
      run(initialAbsence(T0), [
        { kind: "away", at: T0 },
        { kind: "back", at: T0 + 5 * HOUR },
        { kind: "away", at: T0 + 5 * HOUR + 1 },
        { kind: "back", at: T0 + 5 * HOUR + 2 },
      ]),
      [1],
    );
  });
});

const idle: UpdateStatus = { state: "idle" };
const info = { currentVersion: "0.6.23", version: "1.0.8", origin: "poll" };
const downloaded: UpdateStatus = { state: "downloaded", info } as const;

describe("returnAction", () => {
  it("installs the release a poll already fetched", () => {
    strictEqual(
      returnAction({
        status: downloaded,
        turnInFlight: false,
        draftPending: false,
      }),
      "install",
    );
  });

  it("checks with return semantics when nothing is downloaded", () => {
    strictEqual(
      returnAction({ status: idle, turnInFlight: false, draftPending: false }),
      "check",
    );
    strictEqual(
      returnAction({
        status: { state: "error", info, phase: "download" },
        turnInFlight: false,
        draftPending: false,
      }),
      "check",
    );
  });

  it("holds for a turn in flight", () => {
    strictEqual(
      returnAction({
        status: downloaded,
        turnInFlight: true,
        draftPending: false,
      }),
      "hold",
    );
  });

  it("holds for an unsent draft", () => {
    strictEqual(
      returnAction({ status: idle, turnInFlight: false, draftPending: true }),
      "hold",
    );
  });

  it("holds while a download or install is busy", () => {
    strictEqual(
      returnAction({
        status: { state: "downloading", info, progress: 40 },
        turnInFlight: false,
        draftPending: false,
      }),
      "hold",
    );
    strictEqual(
      returnAction({
        status: { state: "installing", info },
        turnInFlight: false,
        draftPending: false,
      }),
      "hold",
    );
  });
});

describe("draftPending", () => {
  it("is false for empty composers and no parked card", () => {
    strictEqual(
      draftPending({ "chat-a": { text: "   ", files: [] } }, {}),
      false,
    );
  });

  it("is true for words, for files, and for a half-walked card", () => {
    strictEqual(
      draftPending({ "chat-a": { text: "hi", files: [] } }, {}),
      true,
    );
    strictEqual(
      draftPending({ "chat-a": { text: "", files: [{ name: "x" }] } }, {}),
      true,
    );
    strictEqual(draftPending({}, { "chat-a": { key: "k" } }), true);
  });
});
