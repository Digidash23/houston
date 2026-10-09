import { describe, expect, test } from "vitest";
import { type BrowserParams, MAX_WAIT_MS, parseBrowserAction } from "./actions";
import { BrowserToolError } from "./errors";

const refused = (params: BrowserParams) => {
  try {
    parseBrowserAction(params);
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserToolError);
    return (error as BrowserToolError).code;
  }
  throw new Error("expected a refusal");
};

describe("parseBrowserAction", () => {
  test("each action keeps exactly the fields it needs", () => {
    expect(
      parseBrowserAction({ action: "open", url: "a.com", ref: "e1" }),
    ).toEqual({ action: "open", url: "a.com" });
    expect(parseBrowserAction({ action: "click", ref: "e3" })).toEqual({
      action: "click",
      ref: "e3",
    });
    expect(
      parseBrowserAction({ action: "select", ref: "e4", value: "Blue" }),
    ).toEqual({ action: "select", ref: "e4", value: "Blue" });
    expect(parseBrowserAction({ action: "press", key: "Enter" })).toEqual({
      action: "press",
      key: "Enter",
    });
    for (const action of ["snapshot", "back", "screenshot", "close"] as const)
      expect(parseBrowserAction({ action, url: "ignored" })).toEqual({
        action,
      });
  });

  test("a missing field is a named refusal, not a page error", () => {
    expect(refused({ action: "open" })).toBe("invalid_action");
    expect(refused({ action: "open", url: "  " })).toBe("invalid_action");
    expect(refused({ action: "click" })).toBe("invalid_action");
    expect(refused({ action: "fill", ref: "e1" })).toBe("invalid_action");
    expect(refused({ action: "select", ref: "e1" })).toBe("invalid_action");
    expect(refused({ action: "press" })).toBe("invalid_action");
    expect(refused({ action: "wait" })).toBe("invalid_action");
  });

  test("fill accepts empty text, which clears a field", () => {
    expect(parseBrowserAction({ action: "fill", ref: "e1", text: "" })).toEqual(
      {
        action: "fill",
        ref: "e1",
        text: "",
      },
    );
  });

  test("a ref copied with its snapshot brackets still resolves", () => {
    expect(parseBrowserAction({ action: "click", ref: "[ref=e12]" })).toEqual({
      action: "click",
      ref: "e12",
    });
    expect(parseBrowserAction({ action: "click", ref: "ref=e2" })).toEqual({
      action: "click",
      ref: "e2",
    });
  });

  test("wait clamps its pause and keeps the text it waits for", () => {
    expect(parseBrowserAction({ action: "wait", ms: 60_000 })).toEqual({
      action: "wait",
      ms: MAX_WAIT_MS,
    });
    expect(parseBrowserAction({ action: "wait", ms: -5 })).toEqual({
      action: "wait",
      ms: 0,
    });
    expect(parseBrowserAction({ action: "wait", text: " Welcome " })).toEqual({
      action: "wait",
      text: "Welcome",
    });
  });
});
