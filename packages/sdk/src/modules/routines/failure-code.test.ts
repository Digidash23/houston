import type { RoutineRunFailureCode } from "@houston/protocol";
import { expect, test } from "vitest";
import { routineFailureCode } from "./failure-code";

test("delivery expiry is classified separately from account failures", () => {
  expect(
    routineFailureCode({ delivery_failure: { code: "pool_delivery_expired" } }),
  ).toBe("pool_delivery_expired");
});

const accountCodes: RoutineRunFailureCode[] = [
  "creator_not_connected",
  "team_not_connected",
  "creator_needs_reconnect",
  "team_needs_reconnect",
  "out_of_credits",
  "model_unavailable",
];

test.each(accountCodes)("keeps the account failure code %s", (code) => {
  expect(routineFailureCode({ failure: { code, provider: "anthropic" } })).toBe(
    code,
  );
});

test("an untyped summary has no classified failure", () => {
  expect(routineFailureCode({})).toBeUndefined();
});
