import type { SDKAssistantMessageError } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderError } from "@houston/runtime-client";
import {
  classifyProviderError,
  stampCredentialScope,
} from "../../ai/provider-error";
import { logProviderError } from "../../ai/provider-error-log";
import {
  noteAuthFailure,
  noteQuotaExhausted,
} from "../../auth/credential-health";
import { reportRevokedServedToken } from "../../auth/report-revoked";
import { authCause } from "./auth-cause";
import {
  type ClaudeRateLimitContext,
  classifyClaudeRateLimit,
  usageLimitFromText,
} from "./usage-limit";

/** The pi provider id this backend runs as — every error is attributed to it. */
const PROVIDER = "anthropic";

/** Context the SDK gives us alongside a typed error enum. */
export interface SdkErrorContext extends ClaudeRateLimitContext {
  /** Verbatim provider failure text (from the message / result), for the card + logs. */
  message: string;
  /** The model the turn ran on, or null when unknown. */
  model: string | null;
  /** HTTP status the SDK surfaced (`result.api_error_status`), when present. */
  status?: number | null;
  /**
   * Digest of the OAuth access token the SDK subprocess authenticates with,
   * captured at spawn preparation (backend.ts → read-token.ts). The
   * revoked-token report names THIS token — never a fresh auth.json read,
   * which a re-serve between the 401 and the report may have replaced
   * (PRODUCT-1319). Undefined = the turn ran on an api_key or the config-dir
   * credential, and the reporter skips.
   */
  usedAccessDigest?: string;
}

/**
 * Map a typed Claude Agent SDK error enum to Houston's `ProviderError` union so
 * the chat renders the matching inline card. Deterministic on the enum: the SDK
 * already classified the failure, so `rate_limit` is always a rate-limit card
 * regardless of the message text (unlike the pi path, which parses a flat string).
 *
 * The verbatim provider text is logged AFTER it is reduced to a typed card
 * (parity with `pi/wire.ts`), through the severity-aware `logProviderError` —
 * the raw reason is otherwise lost once collapsed, and each failure logs
 * exactly once (the fall-through to `classifyText` used to double-log).
 *
 * `invalid_request` / `max_output_tokens` / `unknown` have no clean card of their
 * own, so they fall through to the shared text classifier with the status the SDK
 * gave us — the same path a raw thrown error takes.
 */
export function mapSdkError(
  error: SDKAssistantMessageError,
  ctx: SdkErrorContext,
): ProviderError {
  const message = ctx.message.trim() || "Unknown provider error";
  const model = ctx.model;
  const status = ctx.status ?? null;
  // The enum mappings build their card directly, so they bypass
  // `classifyProviderError` — the one place every OTHER provider error picks up
  // WHOSE credential ran the turn. Stamp it here or a personal-scope member's
  // rate-limit / auth card loses `credential` and cannot offer "continue on the
  // team account" (HOU-976 §5), on the provider whose limits users hit most.
  // A no-op without an acting identity, so desktop/self-host cards are
  // unchanged. The fall-through path is already stamped inside classifyText.
  const enumMapped = mapSdkEnum(error, message, model, status, ctx);
  const mapped = enumMapped ? stampCredentialScope(enumMapped) : null;
  // Fall-through cases delegate to classifyText, which logs for itself.
  if (mapped) {
    logProviderError(mapped, { model, status, sdkError: error });
    // Feed the failure into the status surface: the credential the turn just
    // ran on cannot authenticate, so "Connected" would be a lie until it
    // changes (auth/credential-health.ts).
    if (mapped.kind === "unauthenticated") {
      noteAuthFailure(mapped.provider);
      // A REVOKED served token is invisible to the control plane (HOU-952).
      reportRevokedServedToken(mapped, ctx.usedAccessDigest);
    }
    // An exhausted account is a VALID credential with nothing left — marked
    // separately so status says "out of credits", not "reconnect". A plan
    // usage window is NOT marked: it is often one model's weekly limit while
    // every other model still runs, and "out of credits" would be untrue.
    if (mapped.kind === "quota_exhausted")
      noteQuotaExhausted(mapped.provider, mapped.resets_at);
  }
  return mapped ?? classifyText(message, model, status, ctx.usedAccessDigest);
}

/** The enum-determined mappings; null falls through to the text classifier. */
function mapSdkEnum(
  error: SDKAssistantMessageError,
  message: string,
  model: string | null,
  status: number | null,
  ctx: SdkErrorContext,
): ProviderError | null {
  switch (error) {
    case "authentication_failed":
      return {
        kind: "unauthenticated",
        provider: PROVIDER,
        cause: authCause(message.toLowerCase()),
        message,
      };
    case "oauth_org_not_allowed":
      // Deliberately NOT the shared authentication_failed handling: this is
      // Anthropic's org/policy enforcement (subscription access blocked for
      // this environment), not a credential-lifecycle failure. Reconnecting
      // cannot heal it — Anthropic's own remedy text says use an API key —
      // so the text-derived cause (whose loose "log in again" phrasings read
      // as token_revoked) would file it under the wrong family and render a
      // reconnect CTA that can only fail (PRODUCT-1393).
      return {
        kind: "unauthenticated",
        provider: PROVIDER,
        cause: "org_policy_blocked",
        message,
      };
    case "billing_error":
      return {
        kind: "quota_exhausted",
        provider: PROVIDER,
        model,
        scope: "unknown",
        resets_at: null,
        message,
      };
    case "rate_limit":
      // A subscription usage window and a 429 share this enum; the event
      // beside it and the CLI's own sentence tell them apart (usage-limit.ts).
      return classifyClaudeRateLimit(message, model, ctx);
    case "overloaded":
    case "server_error":
      return {
        kind: "provider_internal",
        provider: PROVIDER,
        http_status: status,
        message,
      };
    case "model_not_found":
      // `model_unavailable` needs a concrete model to name; without one it can't
      // render the "switch model" card, so fall through to the text classifier.
      if (model)
        return {
          kind: "model_unavailable",
          provider: PROVIDER,
          model,
          reason: "unknown",
          suggested_fallback: null,
          message,
        };
      return null;
    default:
      return null;
  }
}

/**
 * Classify raw/untyped failure text (thrown errors, result-error subtypes).
 * `usedAccessDigest` names the spawn-env token for the revoked-token report
 * (see `SdkErrorContext.usedAccessDigest`).
 */
export function classifyText(
  message: string,
  model: string | null,
  status: number | null,
  usedAccessDigest?: string,
): ProviderError {
  // A result-path error carries no enum, but Claude Code's limit sentence is
  // unmistakable; the shared classifier would read it as unknown.
  const limit = usageLimitFromText(message, model);
  const classified = limit
    ? stampCredentialScope(limit)
    : classifyProviderError({
        provider: PROVIDER,
        model,
        message,
        status,
      });
  logProviderError(classified, { model, status });
  if (classified.kind === "unauthenticated") {
    noteAuthFailure(classified.provider);
    // A REVOKED served token is invisible to the control plane (HOU-952).
    // Every seam that classifies here — result `subtype !== "success"`,
    // thrown/iterator failures — must report it like the enum path above and
    // pi/wire.ts do, or a revocation surfacing on this seam never heals
    // centrally and the workspace keeps serving the dead token
    // (PRODUCT-1307). The reporter's own gates keep this safe.
    reportRevokedServedToken(classified, usedAccessDigest);
  }
  if (classified.kind === "quota_exhausted")
    noteQuotaExhausted(classified.provider, classified.resets_at);
  return classified;
}
