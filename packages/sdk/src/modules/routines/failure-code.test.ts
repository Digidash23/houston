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

test("the reader's signed-out account turns a not-connected run into a reconnect", () => {
  const readerFor = (provider: string) => ({
    provider,
    health: "needs_reconnect" as const,
    readerIsCreator: true,
  });
  expect(
    routineFailureCode(
      { failure: { code: "creator_not_connected", provider: "anthropic" } },
      readerFor,
    ),
  ).toBe("creator_needs_reconnect");
  // Delivery expiry is not about an account, whatever the reader says.
  expect(
    routineFailureCode(
      {
        delivery_failure: { code: "pool_delivery_expired" },
        failure: { code: "creator_not_connected", provider: "anthropic" },
      },
      readerFor,
    ),
  ).toBe("pool_delivery_expired");
});
