import { expect, test } from "vitest";
import { healthBody } from "./server";

test.each([false, true])("managed health reflects storeFenced=%s", (fenced) => {
  expect(healthBody({ storeFenced: () => fenced })).toEqual({
    // "fenced" is what makes the readiness probe answer 503 (routes/meta.ts).
    status: fenced ? "fenced" : "ok",
    storeFenced: fenced,
  });
});

test("health omits storeFenced without a managed store", () => {
  expect(healthBody({})).toEqual({ status: "ok" });
});
