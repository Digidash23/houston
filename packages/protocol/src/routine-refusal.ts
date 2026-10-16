/**
 * The 404 a routine write or run-now answers when the routine named in its
 * path is not in the agent's routines file (`PATCH` / `DELETE
 * /agents/:agentId/routines/:routineId`, `POST .../run`): deleted elsewhere,
 * or picked from a list a stale mirror served.
 *
 * It lives in the protocol because both ends have to agree on it: the host
 * mints it, the runtime's op worker reads it to heal the mirror, and the
 * client classifies it (`@houston/wire-types` re-exports this parser). One
 * code and one parser, so they can never drift.
 *
 * Dependency-free and erasable-syntax-only: the app's node test runner loads
 * it through the `@houston/protocol/routine-refusal` subpath.
 */

/** The machine-readable code beside the refusal's reason. */
export const ROUTINE_NOT_FOUND = "routine_not_found";

/** The reason every host answers, the only signal before the code existed. */
export const ROUTINE_NOT_FOUND_REASON = "routine not found";

/** Whether a parsed response body is the routine-not-found refusal. */
export function isRoutineNotFoundBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const value = body as { code?: unknown; error?: unknown };
  if (value.code === ROUTINE_NOT_FOUND) return true;
  // Gateways and workers that predate the code answer the bare reason;
  // matched exactly so no other 404 reason ever reads as this one.
  return value.code === undefined && value.error === ROUTINE_NOT_FOUND_REASON;
}
