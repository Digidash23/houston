// Dependency-free (one SDK subpath) so it is node-testable directly
// (app/tests/send-failure-explained.test.ts).
import { isUploadInterruptedError } from "@houston/sdk/files/upload-interrupted";

/**
 * Whether the toast `call()` already showed for a failed send says the send
 * FAILED, so the generic "couldn't send" toast would only repeat it: an
 * interrupted upload ("Upload didn't finish"), whose surface
 * (`quiet-state-surface.ts`) has no burst gate, so that toast always showed.
 *
 * Deliberately not every error `call()` marked as told. The waking toast says
 * "you don't need to send your message again", wrong for a send that never
 * reached the conversation. The offline toast rides a burst gate that a
 * sustained drop keeps refreshing, so a send during one may show nothing of
 * its own; it keeps the send-failed toast.
 */
export function sendFailureAlreadyExplained(err: unknown): boolean {
  return isUploadInterruptedError(err);
}
