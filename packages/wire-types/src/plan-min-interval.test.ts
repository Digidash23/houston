import { parsePlanMinIntervalRefusal as protocolParse } from "@houston/protocol/plan-min-interval";
import { expect, test } from "vitest";
import { PLAN_MIN_INTERVAL, parsePlanMinIntervalRefusal } from "./plan";

/**
 * The client reads the plan-floor refusal with the protocol's own parser, the
 * one the host's refusal is pinned against: never a second copy that could
 * disagree.
 */
test("the wire contract re-exports the protocol's one parser", () => {
  expect(parsePlanMinIntervalRefusal).toBe(protocolParse);
  expect(PLAN_MIN_INTERVAL).toBe("plan_min_interval");
});
