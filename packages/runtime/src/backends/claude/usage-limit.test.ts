import { beforeEach, expect, test, vi } from "vitest";
import {
  noteAuthFailure,
  noteQuotaExhausted,
} from "../../auth/credential-health";
import { classifyText, mapSdkError } from "./errors";
import {
  classifyClaudeRateLimit,
  USAGE_LIMIT_MIN_RETRY_SECONDS,
  usageLimitFromText,
} from "./usage-limit";

vi.mock("../../auth/report-revoked", () => ({
  reportRevokedServedToken: vi.fn(),
}));
vi.mock("../../auth/credential-health", () => ({
  noteAuthFailure: vi.fn(),
  noteQuotaExhausted: vi.fn(),
}));

const NOW = Date.parse("2026-10-08T20:47:27.000Z");
const RESET = "2026-10-13T05:00:00.000Z";
const WEEKLY =
  "You've reached your Fable limit. Switch to another model, or manage usage credits at https://claude.ai/settings/usage?from=cc_cli_limit_message, to continue.";
const SESSION = "You've hit your session limit · resets 6pm (UTC)";

beforeEach(() => {
  vi.mocked(noteQuotaExhausted).mockClear();
  vi.mocked(noteAuthFailure).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

test("a rejected rate_limit_info is a usage limit with the SDK's reset instant", () => {
  const resetsAt = Date.parse(RESET);
  for (const epoch of [resetsAt, resetsAt / 1000]) {
    expect(
      classifyClaudeRateLimit(
        WEEKLY,
        "claude-fable-5",
        { rateLimit: { status: "rejected", resetsAt: epoch } },
        NOW,
      ),
    ).toEqual({
      kind: "usage_limit_paused",
      provider: "anthropic",
      model: "claude-fable-5",
      resets_at: RESET,
      message: WEEKLY,
    });
  }
});

test("the Claude Code limit sentences are usage limits even without an event", () => {
  expect(classifyClaudeRateLimit(WEEKLY, null, {}, NOW)).toMatchObject({
    kind: "usage_limit_paused",
    resets_at: null,
  });
  // "resets 6pm (UTC)" at 20:47Z is tomorrow's 18:00Z.
  expect(classifyClaudeRateLimit(SESSION, null, {}, NOW)).toMatchObject({
    kind: "usage_limit_paused",
    resets_at: "2026-10-09T18:00:00.000Z",
  });
  // Earlier in the day it is today's 18:00Z, minutes included.
  expect(
    usageLimitFromText(
      "You've hit your session limit · resets 6:30pm (UTC)",
      null,
      Date.parse("2026-10-08T16:12:00Z"),
    ),
  ).toMatchObject({ resets_at: "2026-10-08T18:30:00.000Z" });
  // A zone Intl does not know is an unknown reset, never a guess.
  expect(
    usageLimitFromText(
      "You've hit your session limit · resets 3pm (Mars/Olympus)",
      null,
      NOW,
    ),
  ).toMatchObject({ resets_at: null });
});

test("a wait longer than any rate limit is a usage limit ending when it says", () => {
  const retry = USAGE_LIMIT_MIN_RETRY_SECONDS + 1;
  expect(
    classifyClaudeRateLimit("429", "m", { retryAfterSeconds: retry }, NOW),
  ).toEqual({
    kind: "usage_limit_paused",
    provider: "anthropic",
    model: "m",
    resets_at: new Date(NOW + retry * 1000).toISOString(),
    message: "429",
  });
});

test("an ordinary 429 stays a rate limit, allowed-with-warning events included", () => {
  expect(
    classifyClaudeRateLimit(
      "429 slow down",
      "m",
      {
        rateLimit: { status: "allowed_warning", resetsAt: NOW / 1000 + 60 },
        retryAfterSeconds: 60,
      },
      NOW,
    ),
  ).toEqual({
    kind: "rate_limited",
    provider: "anthropic",
    model: "m",
    retry_after_seconds: 60,
    message: "429 slow down",
  });
  expect(usageLimitFromText("429 slow down", null, NOW)).toBeNull();
  expect(
    usageLimitFromText("prompt is too long: 250000 tokens > limit", null, NOW),
  ).toBeNull();
});

test("mapSdkError hands rate_limit to the usage-limit classifier without an out-of-credits mark", () => {
  const mapped = mapSdkError("rate_limit", {
    message: WEEKLY,
    model: "claude-fable-5",
    rateLimit: { status: "rejected", resetsAt: Date.parse(RESET) },
  });
  expect(mapped).toMatchObject({
    kind: "usage_limit_paused",
    resets_at: RESET,
  });
  // Often one model's weekly limit: the account is not out of credits.
  expect(noteQuotaExhausted).not.toHaveBeenCalled();
  expect(noteAuthFailure).not.toHaveBeenCalled();
});

test("a result-path limit sentence classifies the same way", () => {
  const classified = classifyText(WEEKLY, null, null);
  expect(classified).toMatchObject({
    kind: "usage_limit_paused",
    provider: "anthropic",
    resets_at: null,
  });
  expect(noteQuotaExhausted).not.toHaveBeenCalled();
});

test("the CLI's own <synthetic> model names no model the limit applies to", () => {
  expect(
    classifyClaudeRateLimit(
      WEEKLY,
      "<synthetic>",
      { rateLimit: { status: "rejected", resetsAt: Date.parse(RESET) } },
      NOW,
    ),
  ).toMatchObject({
    kind: "usage_limit_paused",
    model: null,
    resets_at: RESET,
  });
});

test("the older CLI's epoch sentence is a usage limit with that reset", () => {
  expect(
    usageLimitFromText("Claude AI usage limit reached|1760331600", "m", NOW),
  ).toMatchObject({
    kind: "usage_limit_paused",
    resets_at: new Date(1760331600 * 1000).toISOString(),
  });
});
