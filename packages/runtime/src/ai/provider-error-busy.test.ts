import { expect, test } from "vitest";
import { classifyProviderError } from "./provider-error";

/**
 * Failures pi 1.1.0 started retrying. One that still reaches the classifier
 * means pi's retries ran out on a server-side outage: the wait-and-retry card,
 * never the report-bug `unknown`.
 */
test.each([
  ["deepseek", '{"error":{"code":"server_busy","message":"Server busy"}}'],
  ["deepseek", "The servers are currently busy, please try again later."],
  ["mistral", "Provider stopped with: error (server error)"],
])("%s %s → provider_internal", (provider, message) => {
  expect(classifyProviderError({ provider, model: "m", message }).kind).toBe(
    "provider_internal",
  );
});

test("a Gemini policy stop sharing the prefix is not read as an outage", () => {
  const err = classifyProviderError({
    provider: "google",
    model: "gemini-3.8-flash",
    message: "Provider stopped with: SAFETY",
  });
  expect(err.kind).not.toBe("provider_internal");
});
