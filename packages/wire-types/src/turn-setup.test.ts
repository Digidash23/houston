import { describe, expect, it } from "vitest";
import { parseTurnSetupFailure } from "./turn-setup";

describe("parseTurnSetupFailure", () => {
  it("reads the typed code and detail a pooled worker stamps", () => {
    expect(
      parseTurnSetupFailure({
        message: "Your agent could not get ready for this message.",
        code: "hydrate_over_cap",
        detail: "hydrate 812 MiB over the 512 MiB cap",
      }),
    ).toEqual({
      code: "hydrate_over_cap",
      detail: "hydrate 812 MiB over the 512 MiB cap",
    });
  });

  it("reads a legacy worker whose message is the bare code", () => {
    expect(parseTurnSetupFailure({ message: "layout_unexpected" })).toEqual({
      code: "layout_unexpected",
    });
  });

  it("never reads a fenced claim as a setup failure: the turn may have run", () => {
    expect(parseTurnSetupFailure({ message: "claim_fenced" })).toBeNull();
    expect(
      parseTurnSetupFailure({ message: "claim_fenced; sync failed" }),
    ).toBeNull();
    expect(
      parseTurnSetupFailure({ message: "x", code: "claim_fenced" }),
    ).toBeNull();
  });

  it("knows every setup code", () => {
    for (const code of [
      "hydrate_over_cap",
      "layout_unexpected",
      "agent_not_migrated",
      "message_refused",
      "credential_write_failed",
    ])
      expect(parseTurnSetupFailure({ message: "x", code })?.code).toBe(code);
  });

  it("is null for an ordinary turn error or a foreign shape", () => {
    expect(parseTurnSetupFailure({ message: "The turn ended" })).toBeNull();
    expect(parseTurnSetupFailure({ message: "x", code: "nope" })).toBeNull();
    expect(parseTurnSetupFailure({ message: "claim_fenced_x" })).toBeNull();
    expect(parseTurnSetupFailure(null)).toBeNull();
    expect(parseTurnSetupFailure("hydrate_over_cap")).toBeNull();
  });
});
