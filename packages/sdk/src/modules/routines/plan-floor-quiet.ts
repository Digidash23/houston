/**
 * Whether `error` is the engine's refusal of a routine save under the saver's
 * plan floor (`400 plan_min_interval`). An EXPECTED state the person can act
 * on, never a bug: every surface's error layer reads it through the quiet
 * classifier and reports nothing (the plan's info copy is the whole surface).
 * `planMinIntervalRefusal` (./refusals.ts) parses the full body when a caller
 * needs the floor itself.
 *
 * Dependency-free and erasable-syntax-only: the app's node:test entry points
 * load it through the `@houston/sdk/routines/plan-floor-quiet` subpath. Reads
 * the adapter's parsed `body`, a raw text `body`, or the SDK's own error,
 * whose message is the response text.
 */
export function isPlanMinIntervalRefusal(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { status, body } = error as { status?: unknown; body?: unknown };
  if (status !== 400) return false;
  return codeOf(body === undefined ? error.message : body) === CODE;
}

const CODE = "plan_min_interval";

function codeOf(body: unknown): unknown {
  if (typeof body === "string") {
    try {
      return codeOf(JSON.parse(body));
    } catch {
      return null;
    }
  }
  if (typeof body !== "object" || body === null) return null;
  return (body as { code?: unknown }).code;
}
