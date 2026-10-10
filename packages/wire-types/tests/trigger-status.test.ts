import { describe, expect, it } from "vitest";
import {
  parseTriggerStatusReason,
  TRIGGER_STATUS_REASONS,
} from "../src/trigger-status.ts";

describe("parseTriggerStatusReason", () => {
  it("keeps every reason the gateway is known to send", () => {
    for (const reason of TRIGGER_STATUS_REASONS)
      expect(parseTriggerStatusReason(reason)).toBe(reason);
  });

  it("reads a reason from a newer gateway as no reason", () => {
    expect(parseTriggerStatusReason("quota_exhausted")).toBeUndefined();
    expect(parseTriggerStatusReason("")).toBeUndefined();
  });

  it("reads a non-string as no reason", () => {
    for (const value of [undefined, null, 1, {}, ["rejected"]])
      expect(parseTriggerStatusReason(value)).toBeUndefined();
  });
});
