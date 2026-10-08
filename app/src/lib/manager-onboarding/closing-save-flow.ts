/**
 * What the first-run closing does once its transcript save settled. Pure, so
 * app/tests can drive it without React or a browser; use-onboarding-transcript
 * wires it to the page.
 */

/** How the closing's save ended. */
export type SaveOutcome =
  /** The import landed (or had landed before: `imported: 0`). */
  | "saved"
  /** No manager to owe it to; nothing was sent. */
  | "unsaved"
  /** The host refused or never answered; the import stays owed. */
  | "failed"
  /** The PAGE left mid-save (PRODUCT-2040): the import stays owed, and the
   *  stage stays pending so the next load resumes on the closing. */
  | "aborted";

/**
 * `finish` on every outcome but `aborted`: finishing never waits on a failed
 * save (the import is retried on the next load). An abort is the page going
 * away, and finishing from a dying page is what stamped `onboarding_completed`
 * and opened the reloaded app with an empty manager chat. `hold` instead.
 */
export function afterClosingSave(
  outcome: SaveOutcome,
  on: { finish: () => void; hold: () => void },
): void {
  if (outcome === "aborted") on.hold();
  else on.finish();
}

/** The `pageshow` surface, on whatever stands in for `window`. */
export interface PageRestoreTarget {
  addEventListener(
    type: "pageshow",
    handler: (event: { persisted: boolean }) => void,
  ): void;
  removeEventListener(
    type: "pageshow",
    handler: (event: { persisted: boolean }) => void,
  ): void;
}

/**
 * Run `resume` if a held page comes back. A browser may cancel the save's
 * request at `pagehide` and then restore the SAME document from its
 * back/forward cache (`pageshow` with `persisted`): nothing on the closing can
 * be pressed again (the goal handoff latched), so the held save must re-run
 * by itself or the person is stuck until they reload. A `pageshow` without
 * `persisted` is a fresh load, which resumes through the pending stage
 * instead. Returns the way to stop listening; `resume` runs at most once.
 */
export function resumeOnPageRestore(
  target: PageRestoreTarget,
  resume: () => void,
): () => void {
  const handler = (event: { persisted: boolean }) => {
    if (!event.persisted) return;
    target.removeEventListener("pageshow", handler);
    resume();
  };
  target.addEventListener("pageshow", handler);
  return () => target.removeEventListener("pageshow", handler);
}
