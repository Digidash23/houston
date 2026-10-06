import { expect, test } from "vitest";
import { TurnFireError, turnBusyError } from "../channel/fire-error";
import { LauncherClosedError } from "../ports";
import {
  decodeFireOutcome,
  encodeFireOutcome,
  isRetryableFireError,
  unfiredOutcome,
} from "./fire-outcome";
import { RoutineBusyError, RoutineRunUnrecordedError } from "./run";

test("an outcome round-trips through the lock value", () => {
  for (const outcome of [
    { result: "fired", startedAt: "2026-06-12T14:00:01.000Z" },
    { result: "busy" },
    { result: "failed", code: "no_provider", error: "runtime 409" },
    { result: "failed", code: null, error: "boom" },
  ] as const)
    expect(decodeFireOutcome(encodeFireOutcome(outcome))).toEqual(outcome);
});

test("a burn with no recorded outcome replays nothing", () => {
  // "1" is the local scan's burn, an older host's, or an attempt in flight.
  for (const value of [null, "", "1", "not json", '{"result":"weird"}'])
    expect(decodeFireOutcome(value)).toBeNull();
});

test("a recorded failure reason is bounded", () => {
  const value = encodeFireOutcome({
    result: "failed",
    code: null,
    error: "x".repeat(5000),
  });
  const decoded = decodeFireOutcome(value);
  expect(decoded?.result === "failed" && decoded.error.length).toBe(1000);
});

test("only where-it-ran failures are retryable", () => {
  expect(isRetryableFireError(new LauncherClosedError())).toBe(true);
  expect(isRetryableFireError(new TypeError("fetch failed"))).toBe(true);
  expect(
    isRetryableFireError(new RoutineRunUnrecordedError(new Error("x"))),
  ).toBe(true);
  expect(isRetryableFireError(new TypeError("x is not a function"))).toBe(
    false,
  );
  expect(
    isRetryableFireError(new TurnFireError("runtime 409", 409, null)),
  ).toBe(false);
});

test("busy refusals are busy, everything else failed with its code", () => {
  expect(unfiredOutcome(new RoutineBusyError("r"))).toEqual({ result: "busy" });
  expect(unfiredOutcome(turnBusyError(null))).toEqual({ result: "busy" });
  expect(
    unfiredOutcome(new TurnFireError("runtime 409", 409, "no_provider")),
  ).toEqual({ result: "failed", code: "no_provider", error: "runtime 409" });
  expect(unfiredOutcome("raw")).toEqual({
    result: "failed",
    code: null,
    error: "raw",
  });
});
