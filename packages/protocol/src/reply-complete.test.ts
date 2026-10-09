import { describe, expect, it } from "vitest";
import { isOfferToolName } from "./reply-complete";

describe("isOfferToolName", () => {
  it("matches the bare offer tools", () => {
    expect(isOfferToolName("suggest_actions")).toBe(true);
    expect(isOfferToolName("suggest_reusable")).toBe(true);
  });

  it("matches the Claude MCP-prefixed names", () => {
    expect(isOfferToolName("mcp__houston__suggest_actions")).toBe(true);
    expect(isOfferToolName("mcp__houston__suggest_reusable")).toBe(true);
  });

  it("refuses every other tool", () => {
    expect(isOfferToolName("ask_user")).toBe(false);
    expect(isOfferToolName("mcp__houston__ask_user")).toBe(false);
    expect(isOfferToolName("Bash")).toBe(false);
    expect(isOfferToolName("suggest_actions_v2")).toBe(false);
  });
});
