import { describe, expect, it } from "vitest";
import {
  parseProviderRefusal,
  parseProviderRefusalText,
} from "./provider-refusal";

describe("parseProviderRefusal", () => {
  it("reads the gateway's account-blocked refusal with its provider", () => {
    expect(
      parseProviderRefusal({
        error:
          "The github-copilot account is blocked by the provider. Fix it there, or connect another AI.",
        code: "provider_account_blocked",
        provider: "github-copilot",
      }),
    ).toEqual({
      code: "provider_account_blocked",
      error:
        "The github-copilot account is blocked by the provider. Fix it there, or connect another AI.",
      provider: "github-copilot",
    });
  });

  it("reads the not-connected refusal, which names no provider", () => {
    expect(
      parseProviderRefusal({
        error: "No provider connected. Connect an AI provider first.",
        code: "no_provider",
      }),
    ).toEqual({
      code: "no_provider",
      error: "No provider connected. Connect an AI provider first.",
    });
  });

  it("drops an empty provider and refuses every other body", () => {
    expect(
      parseProviderRefusal({ error: "x", code: "no_provider", provider: "" }),
    ).toEqual({ code: "no_provider", error: "x" });
    expect(parseProviderRefusal({ error: "turn running" })).toBeNull();
    expect(
      parseProviderRefusal({ error: "x", code: "compute_busy" }),
    ).toBeNull();
    expect(parseProviderRefusal({ code: "no_provider" })).toBeNull();
    expect(parseProviderRefusal(null)).toBeNull();
    expect(parseProviderRefusal("no_provider")).toBeNull();
  });

  it("parses raw text and treats non-JSON as no refusal", () => {
    expect(
      parseProviderRefusalText(
        '{"error":"blocked","code":"provider_account_blocked"}',
      ),
    ).toEqual({ code: "provider_account_blocked", error: "blocked" });
    expect(parseProviderRefusalText("<html>502</html>")).toBeNull();
  });
});
