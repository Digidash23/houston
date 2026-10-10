/**
 * "The user already read authored copy for this error" marker, carried on the
 * thrown error. `call()` (`lib/tauri.ts`) stamps it when its expected-state
 * ladder showed a toast of its own (last owner, expired trial, offline, pod
 * waking...). An optimistic write's rollback toast reads it so the same
 * refusal never toasts twice. Unknown failures stay unmarked: `call()` only
 * reports those, so the rollback toast is the one thing the user sees.
 *
 * `Symbol.for` for the same reason as `sentry-reported-mark.ts`: the web build
 * composes `app/src` through a second module graph.
 */
const TOLD_USER = Symbol.for("houston.error.toldUser");

/** No-op for values that cannot hold a marker: a second toast at worst. */
export function markToldUser(err: unknown): void {
  if (!err || typeof err !== "object" || !Object.isExtensible(err)) return;
  (err as Record<symbol, unknown>)[TOLD_USER] = true;
}

export function wasToldUser(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as Record<symbol, unknown>)[TOLD_USER] === true
  );
}
