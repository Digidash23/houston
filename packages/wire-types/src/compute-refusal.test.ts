import { describe, expect, it } from "vitest";
import {
  parseComputeRefusal,
  parseComputeRefusalText,
} from "./compute-refusal";

describe("parseComputeRefusal", () => {
  it("reads the gateway's compute_busy refusal", () => {
    expect(
      parseComputeRefusal({
        error: "engine unavailable",
        code: "compute_busy",
        detail: "sandbox_queue_timeout",
        retryAfterMs: 3000,
      }),
    ).toEqual({
      error: "engine unavailable",
      code: "compute_busy",
      detail: "sandbox_queue_timeout",
      retryAfterMs: 3000,
    });
  });

  it("reads an op's busy refusal, which keeps its own error string", () => {
    expect(
      parseComputeRefusal({
        error: "agent busy; retry in a moment",
        code: "compute_busy",
      }),
    ).toEqual({ error: "agent busy; retry in a moment", code: "compute_busy" });
  });

  it("reads pod_wake_refused", () => {
    expect(
      parseComputeRefusal({
        error: "engine unavailable",
        code: "pod_wake_refused",
      })?.code,
    ).toBe("pod_wake_refused");
  });

  it("refuses everything else", () => {
    expect(parseComputeRefusal({ error: "engine unavailable" })).toBeNull();
    expect(
      parseComputeRefusal({
        error: "engine unavailable",
        code: "message_limit",
      }),
    ).toBeNull();
    expect(parseComputeRefusal({ code: "compute_busy" })).toBeNull();
    expect(parseComputeRefusal(null)).toBeNull();
    expect(parseComputeRefusal("compute_busy")).toBeNull();
  });

  it("drops a retry hint it cannot use", () => {
    expect(
      parseComputeRefusal({
        error: "engine unavailable",
        code: "compute_busy",
        retryAfterMs: -1,
      })?.retryAfterMs,
    ).toBeUndefined();
  });

  it("parses raw response text, and nothing from prose", () => {
    expect(
      parseComputeRefusalText(
        '{"error":"engine unavailable","code":"compute_busy"}',
      )?.code,
    ).toBe("compute_busy");
    expect(parseComputeRefusalText("Service Unavailable")).toBeNull();
  });
});
