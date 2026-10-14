import { expect, test } from "vitest";
import { trimTrailingSlashes } from "./trim-slashes";

test("trims every trailing slash and nothing else", () => {
  expect(trimTrailingSlashes("https://h.example///")).toBe("https://h.example");
  expect(trimTrailingSlashes("https://h.example/v1")).toBe(
    "https://h.example/v1",
  );
  expect(trimTrailingSlashes("///")).toBe("");
  expect(trimTrailingSlashes("")).toBe("");
});

test("stays linear on a long run of slashes", () => {
  const hostile = `${"/".repeat(200_000)}x`;
  const started = performance.now();
  expect(trimTrailingSlashes(hostile)).toBe(hostile);
  expect(performance.now() - started).toBeLessThan(50);
});
