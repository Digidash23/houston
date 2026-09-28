import { describe, expect, it } from "vitest";
import {
  AGENT_NAME_MAX_LENGTH,
  agentNameKey,
  invalidAgentNameMessage,
  sameAgentName,
  validateAgentName,
} from "./agent-name";

describe("validateAgentName", () => {
  it("accepts ordinary names and returns them trimmed", () => {
    expect(validateAgentName("Personal assistant")).toEqual({
      ok: true,
      name: "Personal assistant",
    });
    expect(validateAgentName("  Bookkeeper  ")).toEqual({
      ok: true,
      name: "Bookkeeper",
    });
    expect(validateAgentName("Ana's agent (v2)")).toEqual({
      ok: true,
      name: "Ana's agent (v2)",
    });
    // Interior dots are fine; only leading dots hide the folder.
    expect(validateAgentName("v2.0 helper").ok).toBe(true);
  });

  it("rejects empty and whitespace-only names", () => {
    expect(validateAgentName("")).toEqual({ ok: false, reason: "empty" });
    expect(validateAgentName("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects names over the length cap", () => {
    expect(validateAgentName("a".repeat(AGENT_NAME_MAX_LENGTH)).ok).toBe(true);
    expect(validateAgentName("a".repeat(AGENT_NAME_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("rejects path separators, '..', leading dots, and control characters", () => {
    for (const name of [
      "hello/",
      "a/b",
      "a\\b",
      "..",
      "a..b",
      ".hidden",
      "a\nb",
      "a\u0000b",
    ]) {
      expect(validateAgentName(name)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("has a message for every reason", () => {
    expect(invalidAgentNameMessage("empty")).toMatch(/empty/);
    expect(invalidAgentNameMessage("too_long")).toContain(
      String(AGENT_NAME_MAX_LENGTH),
    );
    expect(invalidAgentNameMessage("invalid")).toMatch(/slashes/);
  });
});

describe("sameAgentName", () => {
  it("treats names that land on one folder as the same name", () => {
    expect(sameAgentName("Mia", "Mia")).toBe(true);
    expect(sameAgentName("Mia", "mia")).toBe(true);
    expect(sameAgentName("  MIA ", "mia")).toBe(true);
    // Composed and decomposed é are one name on APFS.
    expect(sameAgentName("Jos\u00e9", "Jose\u0301")).toBe(true);
  });

  it("keeps genuinely different names apart", () => {
    expect(sameAgentName("Mia", "Mia 2")).toBe(false);
    expect(sameAgentName("Mia", "Mía")).toBe(false);
  });

  it("keys on the trimmed, composed, lowercased spelling", () => {
    expect(agentNameKey("  Jose\u0301 ")).toBe("jos\u00e9");
  });
});
