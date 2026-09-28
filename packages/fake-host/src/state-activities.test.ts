import type { Activity } from "@houston/protocol";
import { expect, it } from "vitest";
import { createActivity } from "./state-activities";

/**
 * The fake host takes server-stamped keys off a seeding POST so an e2e can
 * show every board tag, but only in the shape the real host would stamp.
 */

it("seeds a mission's starter, and drops one the real host never stamps", () => {
  const houston = createActivity("seed-agent", {
    title: "t",
    started_by: "houston",
  });
  expect(houston.started_by).toBe("houston");
  // A POST body is untyped JSON: the value arrives however the caller wrote it.
  const body: Partial<Activity> = JSON.parse(
    '{"title":"t","started_by":"person"}',
  );
  const forged = createActivity("seed-agent", body);
  expect("started_by" in forged).toBe(false);
});
