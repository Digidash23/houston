/**
 * Status-less server failures pi 1.1.0 retries itself, so one reaches the
 * classifier only after pi's retries ran out. `server_busy` and "servers are
 * currently busy" are load bodies. Mistral's `finish_reason: "error"` is a
 * server failure pi flattens to `Provider stopped with: error (server error)`,
 * matched in full because Gemini policy stops (`SAFETY`) share the prefix.
 *
 * `lower` is the already-lowercased error message.
 */
export function isRetriedServerFailure(lower: string): boolean {
  return (
    lower.includes("server_busy") ||
    lower.includes("servers are currently busy") ||
    lower.includes("provider stopped with: error (server error)")
  );
}
