import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  onboardingSegmentLocalKey,
  parseLegacySegmentPreference,
} from "../src/lib/onboarding-legacy-segment.ts";

const record = (fields: Record<string, unknown>) =>
  JSON.stringify({
    segment: "operations",
    selectedAt: "2026-07-09T00:00:00.000Z",
    sourceScreen: "first_run_segment",
    ...fields,
  });

describe("legacy segment preference", () => {
  it("reads a stored department as an answer", () => {
    deepStrictEqual(parseLegacySegmentPreference(record({})), {
      segment: "operations",
      selectedAt: "2026-07-09T00:00:00.000Z",
    });
  });

  it("reads a department this build no longer lists, and a skip", () => {
    strictEqual(
      parseLegacySegmentPreference(record({ segment: "student" }))?.segment,
      "student",
    );
    strictEqual(
      parseLegacySegmentPreference(record({ segment: "skipped" }))?.segment,
      "skipped",
    );
  });

  it("rejects what is not a legacy record", () => {
    strictEqual(parseLegacySegmentPreference(null), null);
    strictEqual(parseLegacySegmentPreference("{bad json"), null);
    strictEqual(parseLegacySegmentPreference(record({ segment: "" })), null);
    strictEqual(parseLegacySegmentPreference(record({ segment: 3 })), null);
    strictEqual(
      parseLegacySegmentPreference(record({ sourceScreen: "elsewhere" })),
      null,
    );
    strictEqual(
      parseLegacySegmentPreference(record({ selectedAt: undefined })),
      null,
    );
  });

  it("keys the device mirror by account", () => {
    strictEqual(
      onboardingSegmentLocalKey("u1"),
      "houston.onboarding-segment.u1",
    );
    strictEqual(
      onboardingSegmentLocalKey(null),
      "houston.onboarding-segment.local",
    );
  });
});
