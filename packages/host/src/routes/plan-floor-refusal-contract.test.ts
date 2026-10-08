import {
  PLAN_MIN_INTERVAL,
  parsePlanMinIntervalRefusal,
} from "@houston/protocol/plan-min-interval";
import { describe, expect, it } from "vitest";
import { planFloorRefusal } from "./routine-write-gates";

/**
 * Contract: every `400 plan_min_interval` body the host answers is the exact
 * refusal the client parses. The protocol's parser is the client's one
 * (`@houston/wire-types` re-exports it; the SDK's `planMinIntervalRefusal`
 * classifies a refused save with it, and the app's toast names the floor from
 * it), so a body it rejects would surface as a bug report instead of the
 * plan's copy. Each body crosses the wire as JSON, so it is round-tripped
 * before parsing. The routes' real HTTP bodies are pinned the same way in
 * agent-data-routine-floor.test.ts.
 */
const overTheWire = (body: unknown): unknown =>
  JSON.parse(JSON.stringify(body));

describe("the host's plan-floor refusal parses as the client reads it", () => {
  for (const [name, kept] of [
    ["a new or changed schedule", false],
    ["a kept fast schedule", true],
  ] as const)
    it(`for ${name}, at any floor`, () => {
      for (const floor of [15, 30, 60]) {
        const refusal = planFloorRefusal("*/5 * * * *", floor, kept);
        expect(refusal).not.toBeNull();
        expect(parsePlanMinIntervalRefusal(overTheWire(refusal))).toEqual({
          error: refusal?.error,
          code: PLAN_MIN_INTERVAL,
          minIntervalMinutes: floor,
        });
      }
    });
});
