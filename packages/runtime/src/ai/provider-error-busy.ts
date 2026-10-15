/** pi-ai's `provider.?returned.?(?:an.?)?error` retry pattern (utils/retry). */
const UPSTREAM_PROVIDER_ERROR = /provider.?returned.?(?:an.?)?error/;
/** pi-ai's `service.?(?:is.?)?(?:temporarily.?)?unavailable` (utils/retry). */
const SERVICE_UNAVAILABLE = /service.?(?:is.?)?(?:temporarily.?)?unavailable/;

/**
 * Status-less server failures pi retries itself, so one reaches the
 * classifier only after pi's retries ran out. `server_busy` and "servers are
 * currently busy" are load bodies. Mistral's `finish_reason: "error"` is a
 * server failure pi flattens to `Provider stopped with: error (server error)`,
 * matched in full because Gemini policy stops (`SAFETY`) share the prefix.
 * OpenRouter's "Provider returned error" and gateways' "The upstream provider
 * returned an error" use pi's own retry pattern, but only with no status:
 * OpenRouter wraps upstream 4xx refusals (missing model, bad tool schema,
 * moderation) in the same words, and those must keep their own verdict.
 * Mistral's API hanging before it sends headers surfaces (since pi 1.2.0) as
 * `Mistral response headers timed out after <ms>ms`.
 * pi 1.3.0 added "The service is temporarily unavailable" and a gateway's
 * `Unable to forward upstream stream` (a Responses `response.failed` with no
 * error code) to its retry list. Both are status-gated the same way: a 5xx
 * already reads as a server failure by its status.
 *
 * `lower` is the already-lowercased error message.
 */
export function isRetriedServerFailure(
  lower: string,
  status: number | null,
): boolean {
  return (
    lower.includes("server_busy") ||
    lower.includes("servers are currently busy") ||
    lower.includes("provider stopped with: error (server error)") ||
    lower.includes("response headers timed out") ||
    (status === null &&
      (UPSTREAM_PROVIDER_ERROR.test(lower) ||
        SERVICE_UNAVAILABLE.test(lower) ||
        lower.includes("unable to forward upstream")))
  );
}
