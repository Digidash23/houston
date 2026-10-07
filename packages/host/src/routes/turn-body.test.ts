import { expect, test } from "vitest";
import { turnLimitsOf, turnPinOf } from "./turn-body";

const body = (v: unknown) => Buffer.from(JSON.stringify(v));

test("a send's provider/model/effort become the turn's pin", () => {
  expect(
    turnPinOf(
      body({
        text: "hi",
        provider: "anthropic",
        model: "claude-sonnet-5",
        effort: "medium",
      }),
    ),
  ).toEqual({
    provider: "anthropic",
    model: "claude-sonnet-5",
    effort: "medium",
  });
});

test("no provider means no pin, whatever else the body carries", () => {
  expect(
    turnPinOf(body({ text: "hi", model: "claude-sonnet-5" })),
  ).toBeUndefined();
  expect(turnPinOf(body({ text: "hi", provider: "" }))).toBeUndefined();
  expect(turnPinOf(Buffer.from(""))).toBeUndefined();
  expect(turnPinOf(Buffer.from("{not json"))).toBeUndefined();
});

test("empty model and effort are absent, not empty strings", () => {
  expect(
    turnPinOf(body({ provider: "anthropic", model: "", effort: null })),
  ).toEqual({ provider: "anthropic" });
});

test("the gateway's plan stamp becomes the turn's limits", () => {
  expect(
    turnLimitsOf(
      body({ text: "hi", limits: { routineMinIntervalMinutes: 15 } }),
    ),
  ).toEqual({ routineMinIntervalMinutes: 15 });
});

test("a body with no usable limits stamp records none", () => {
  expect(turnLimitsOf(body({ text: "hi" }))).toBeUndefined();
  expect(
    turnLimitsOf(body({ limits: { routineMinIntervalMinutes: 0 } })),
  ).toBeUndefined();
  expect(turnLimitsOf(body(null))).toBeUndefined();
  expect(turnLimitsOf(Buffer.from("{not json"))).toBeUndefined();
});
