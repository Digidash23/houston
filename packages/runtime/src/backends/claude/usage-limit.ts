import type { ProviderError } from "@houston/runtime-client";
import { extractRetryAfterSeconds } from "../../ai/provider-error";
import { resetFromText } from "./usage-limit-reset";

/** The pi provider id this backend runs as. */
const PROVIDER = "anthropic";
const SYNTHETIC_MODEL = "<synthetic>";

/**
 * Telling a subscription USAGE limit from a rate limit. Claude Code reports
 * both as the `rate_limit` error enum; what differs is the `rate_limit_event`
 * beside it (`status: "rejected"` with the window's `resetsAt`: the 5-hour
 * session window or a weekly per-model one) and the sentence it writes into
 * the assistant message itself ("You've hit your session limit · resets 6pm
 * (UTC)", "You've reached your Fable limit. Switch to another model…").
 * A rate limit clears in seconds and is retried; a usage limit holds for
 * hours or days and must not be (a routine firing into one every five
 * minutes burned 188 sandbox turns, H-004), so it gets its own kind,
 * `usage_limit_paused`, carrying the reset the scheduler snoozes until.
 */

/**
 * The longest wait a plain rate limit asks for. Anthropic's API 429s say
 * seconds to a few minutes; anything past an hour is a window, not a queue.
 */
export const USAGE_LIMIT_MIN_RETRY_SECONDS = 60 * 60;

/** The `rate_limit_event` fields the classification reads (SDKRateLimitInfo). */
export interface ClaudeRateLimitInfo {
  status?: string;
  /** Epoch of the window's reset: seconds, or milliseconds above 1e12. */
  resetsAt?: number | null;
}

export interface ClaudeRateLimitContext {
  /** The turn's latest `rate_limit_event`, when one arrived before the error. */
  rateLimit?: ClaudeRateLimitInfo | null;
  /** Seconds until reset when already derived (from the event or the text). */
  retryAfterSeconds?: number | null;
}

/**
 * Claude Code's own limit sentences, and only those: "You've hit your session
 * limit", "You've hit your weekly limit", "You've reached your Fable limit"
 * (a capitalised model name, so case matters), and the older "Claude AI usage
 * limit reached|<epoch>". A spend or budget cap ("monthly spend limit",
 * "maximum budget limit") is not a window that resets by itself and must not
 * snooze, so the sentence names its kind of limit exactly.
 */
const LIMIT_SENTENCE =
  /[Yy]ou(?:['’]ve| have) (?:hit|reached) your (?:(?:session|weekly|usage) limit|[A-Z][a-z]+(?: \d[\d.]*)? limit)\b/;
const LIMIT_EPOCH = /\busage limit reached\b/i;

/**
 * Classify a `rate_limit` error: a usage limit when the event says the
 * window was rejected, when the text is Claude Code's own limit sentence, or
 * when the wait is longer than any rate limit; else the ordinary rate limit.
 */
export function classifyClaudeRateLimit(
  message: string,
  model: string | null,
  ctx: ClaudeRateLimitContext,
  nowMs: number = Date.now(),
): ProviderError {
  // Only a rejected event's reset is the instant requests resume; an allowed
  // event's resetsAt is just when its window rolls over (translate.ts).
  const rejected = ctx.rateLimit?.status === "rejected";
  const eventReset = rejected ? resetFromEvent(ctx.rateLimit) : null;
  const fromText = usageLimitFromText(message, model, nowMs);
  if (fromText)
    return { ...fromText, resets_at: eventReset ?? fromText.resets_at };
  const retry = ctx.retryAfterSeconds ?? extractRetryAfterSeconds(message);
  // A rejected window that reopens within the hour is waited out like a 429.
  if (rejected && (retry === null || retry > USAGE_LIMIT_MIN_RETRY_SECONDS))
    return limit(message, model, eventReset ?? resetFromText(message, nowMs));
  if (retry !== null && retry > USAGE_LIMIT_MIN_RETRY_SECONDS) {
    return limit(message, model, new Date(nowMs + retry * 1000).toISOString());
  }
  return {
    kind: "rate_limited",
    provider: PROVIDER,
    model,
    retry_after_seconds: retry,
    message,
  };
}

/**
 * The usage limit Claude Code's own sentence describes, or null when the text
 * is not one. Used by the result path too, where no error enum arrives.
 */
export function usageLimitFromText(
  message: string,
  model: string | null,
  nowMs: number = Date.now(),
): Extract<ProviderError, { kind: "usage_limit_paused" }> | null {
  if (!LIMIT_SENTENCE.test(message) && !LIMIT_EPOCH.test(message)) return null;
  return limit(message, model, resetFromText(message, nowMs));
}

function limit(
  message: string,
  model: string | null,
  resetsAt: string | null,
): Extract<ProviderError, { kind: "usage_limit_paused" }> {
  return {
    kind: "usage_limit_paused",
    provider: PROVIDER,
    // Claude Code stamps the message it writes itself with model
    // "<synthetic>"; that names no model the limit applies to.
    model: model === SYNTHETIC_MODEL ? null : model,
    resets_at: resetsAt,
    message,
  };
}

function resetFromEvent(info: ClaudeRateLimitInfo | null | undefined) {
  const at = info?.resetsAt;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return new Date(at < 1e12 ? at * 1000 : at).toISOString();
}
