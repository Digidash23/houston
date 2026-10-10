import { describe, expect, it } from "vitest";
import {
  BROWSER_LIVE_INPUT_TIMEOUT_MS,
  BROWSER_LIVE_MAX_EVENTS,
  BROWSER_LIVE_MAX_TEXT,
  BROWSER_LIVE_VIEWER,
} from "./browser-live";
import {
  browserHandoffFailureOf,
  parseBrowserLiveEvent,
  parseBrowserLiveInputAnswer,
  parseBrowserLiveInputRequest,
} from "./browser-live-parse";

describe("parseBrowserLiveEvent", () => {
  it("reads each event type", () => {
    const frame = {
      type: "frame",
      seq: 3,
      jpeg: "AAA",
      width: 1280,
      height: 800,
    };
    expect(parseBrowserLiveEvent(frame)).toEqual(frame);
    expect(
      parseBrowserLiveEvent({ type: "page", url: "https://a.com", title: "A" }),
    ).toEqual({ type: "page", url: "https://a.com", title: "A" });
    const status = {
      type: "status",
      handoffId: "0b6c3f9e-8d1a-4f2b-9c3d-5e6f7a8b9c0d",
      state: "waiting",
      text: "Sign in",
      expiresAt: 1,
    };
    expect(parseBrowserLiveEvent(status)).toEqual(status);
  });

  it("drops fields outside the contract", () => {
    expect(
      parseBrowserLiveEvent({ type: "page", url: "u", title: "t", extra: 1 }),
    ).toEqual({ type: "page", url: "u", title: "t" });
  });

  it.each([
    null,
    [],
    { type: "nope" },
    { type: "frame", seq: -1, jpeg: "A", width: 1, height: 1 },
    { type: "frame", seq: 1.5, jpeg: "A", width: 1, height: 1 },
    { type: "frame", seq: 1, jpeg: "", width: 1, height: 1 },
    { type: "frame", seq: 1, jpeg: "A", width: 0, height: 1 },
    { type: "frame", seq: 1, jpeg: "A", width: Number.NaN, height: 1 },
    { type: "page", url: 1, title: "t" },
    {
      type: "status",
      handoffId: "handoff-1",
      state: "gone",
      text: "",
      expiresAt: 1,
    },
    {
      type: "status",
      handoffId: "handoff-1",
      state: "done",
      text: "",
      expiresAt: Infinity,
    },
    { type: "status", state: "done", text: "", expiresAt: 1 },
    {
      type: "status",
      handoffId: "short",
      state: "done",
      text: "",
      expiresAt: 1,
    },
  ])("throws on %j", (value) => {
    expect(() => parseBrowserLiveEvent(value)).toThrow();
  });
});

describe("parseBrowserLiveInputRequest", () => {
  it("reads a full batch and clamps coordinates to the frame", () => {
    expect(
      parseBrowserLiveInputRequest({
        events: [
          {
            type: "mouse",
            action: "click",
            x: 1.4,
            y: -0.2,
            buttons: 1,
            clickCount: 2,
          },
          { type: "wheel", x: 0.5, y: 0.5, dx: 0, dy: -120 },
          { type: "key", key: "Enter", modifiers: 8 },
          { type: "text", text: "hello" },
          { type: "navigate", url: " https://a.com " },
          { type: "back" },
        ],
        handoff: "handoff-1",
        ack: { viewer: "viewer_12345", seq: 3 },
        batch: { viewer: "viewer_12345", seq: 7 },
        finish: "done",
      }),
    ).toEqual({
      handoff: "handoff-1",
      events: [
        {
          type: "mouse",
          action: "click",
          x: 1,
          y: 0,
          buttons: 1,
          clickCount: 2,
        },
        { type: "wheel", x: 0.5, y: 0.5, dx: 0, dy: -120 },
        { type: "key", key: "Enter", modifiers: 8 },
        { type: "text", text: "hello" },
        { type: "navigate", url: "https://a.com" },
        { type: "back" },
      ],
      ack: { viewer: "viewer_12345", seq: 3 },
      batch: { viewer: "viewer_12345", seq: 7 },
      finish: "done",
    });
  });

  it("accepts the first batch and the largest safe batch seq", () => {
    for (const seq of [1, Number.MAX_SAFE_INTEGER])
      expect(
        parseBrowserLiveInputRequest({ batch: { viewer: "viewer_12345", seq } })
          .batch,
      ).toEqual({ viewer: "viewer_12345", seq });
  });

  it("accepts an empty body and a finish naming its hand-off", () => {
    expect(parseBrowserLiveInputRequest({})).toEqual({});
    expect(
      parseBrowserLiveInputRequest({ handoff: "handoff-1", finish: "cancel" }),
    ).toEqual({ handoff: "handoff-1", finish: "cancel" });
  });

  it("accepts exactly the event and text limits", () => {
    const events = Array.from({ length: BROWSER_LIVE_MAX_EVENTS }, () => ({
      type: "back",
    }));
    expect(
      parseBrowserLiveInputRequest({ handoff: "handoff-1", events }).events,
    ).toHaveLength(64);
    const text = "a".repeat(BROWSER_LIVE_MAX_TEXT);
    expect(
      parseBrowserLiveInputRequest({
        handoff: "handoff-1",
        events: [{ type: "text", text }],
      }),
    ).toEqual({ handoff: "handoff-1", events: [{ type: "text", text }] });
  });

  it("refuses input, acks and finishes that name no hand-off", () => {
    for (const body of [
      { events: [{ type: "back" }] },
      { ack: { viewer: "viewer_12345", seq: 1 } },
      { finish: "done" },
    ])
      expect(() => parseBrowserLiveInputRequest(body)).toThrow(
        "without handoff",
      );
  });

  const one = (event: unknown) => ({ handoff: "handoff-1", events: [event] });
  it.each([
    ["not an object", "x"],
    ["events not an array", { events: {} }],
    [
      "too many events",
      {
        events: Array.from({ length: BROWSER_LIVE_MAX_EVENTS + 1 }, () => ({
          type: "back",
        })),
      },
    ],
    ["unknown event", one({ type: "drag" })],
    [
      "non-finite x",
      one({ type: "mouse", action: "move", x: Number.NaN, y: 0 }),
    ],
    ["infinite wheel", one({ type: "wheel", x: 0, y: 0, dx: Infinity, dy: 0 })],
    ["bad mouse action", one({ type: "mouse", action: "drag", x: 0, y: 0 })],
    [
      "bad buttons",
      one({ type: "mouse", action: "down", x: 0, y: 0, buttons: 2 }),
    ],
    [
      "bad clickCount",
      one({ type: "mouse", action: "click", x: 0, y: 0, clickCount: 4 }),
    ],
    ["unknown key", one({ type: "key", key: "F5" })],
    ["modifier out of range", one({ type: "key", key: "Tab", modifiers: 16 })],
    ["empty text", one({ type: "text", text: "" })],
    [
      "text over limit",
      one({ type: "text", text: "a".repeat(BROWSER_LIVE_MAX_TEXT + 1) }),
    ],
    ["empty url", one({ type: "navigate", url: "  " })],
    ["bad viewer", { ack: { viewer: "short", seq: 1 } }],
    ["bad ack seq", { ack: { viewer: "viewer_12345", seq: -1 } }],
    ["bad finish", { handoff: "handoff-1", finish: "later" }],
    ["finish without its hand-off", { finish: "done" }],
    ["bad handoff", { handoff: "no way", events: [] }],
    ["handoff not a string", { handoff: 7 }],
    ["batch not an object", { batch: 1 }],
    ["bad batch viewer", { batch: { viewer: "short", seq: 1 } }],
    ["batch seq zero", { batch: { viewer: "viewer_12345", seq: 0 } }],
    ["fractional batch seq", { batch: { viewer: "viewer_12345", seq: 1.5 } }],
    [
      "unsafe batch seq",
      { batch: { viewer: "viewer_12345", seq: Number.MAX_SAFE_INTEGER + 1 } },
    ],
    ["missing batch seq", { batch: { viewer: "viewer_12345" } }],
  ])("throws on %s", (_name, value) => {
    expect(() => parseBrowserLiveInputRequest(value)).toThrow();
  });
});

describe("BROWSER_LIVE_INPUT_TIMEOUT_MS", () => {
  it("is the client's 15 s per-POST budget", () => {
    expect(BROWSER_LIVE_INPUT_TIMEOUT_MS).toBe(15_000);
  });
});

describe("BROWSER_LIVE_VIEWER", () => {
  it("bounds the viewer id", () => {
    expect(BROWSER_LIVE_VIEWER.test("abcdefgh")).toBe(true);
    expect(BROWSER_LIVE_VIEWER.test("a".repeat(65))).toBe(false);
    expect(BROWSER_LIVE_VIEWER.test("abc def gh")).toBe(false);
  });
});

describe("parseBrowserLiveInputAnswer", () => {
  it("reads the state and a url refusal", () => {
    expect(parseBrowserLiveInputAnswer({ state: "waiting" })).toEqual({
      state: "waiting",
    });
    expect(
      parseBrowserLiveInputAnswer({ state: "waiting", refused: "url_refused" }),
    ).toEqual({ state: "waiting", refused: "url_refused" });
  });

  it("throws on drift", () => {
    expect(() => parseBrowserLiveInputAnswer({ state: "gone" })).toThrow();
    expect(() =>
      parseBrowserLiveInputAnswer({ state: "done", refused: "other" }),
    ).toThrow();
    expect(() => parseBrowserLiveInputAnswer(null)).toThrow();
  });
});

describe("browserHandoffFailureOf", () => {
  it("reads each known failure code", () => {
    expect(browserHandoffFailureOf("ERROR handoff_cancelled: closed")).toBe(
      "handoff_cancelled",
    );
    expect(browserHandoffFailureOf("ERROR handoff_expired: late")).toBe(
      "handoff_expired",
    );
    expect(browserHandoffFailureOf("x ERROR handoff_unavailable: no")).toBe(
      "handoff_unavailable",
    );
  });

  it("ignores other codes, unknown handoff codes and late matches", () => {
    expect(browserHandoffFailureOf("ERROR page_error: boom")).toBeNull();
    expect(browserHandoffFailureOf("ERROR handoff_lost: x")).toBeNull();
    expect(browserHandoffFailureOf("The person finished")).toBeNull();
    expect(
      browserHandoffFailureOf(`${"a ".repeat(120)}ERROR handoff_expired: x`),
    ).toBeNull();
  });
});
