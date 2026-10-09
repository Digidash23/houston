import { reportError } from "./error-report";
import { reportQuietError } from "./quiet-error-report";
import { toUpdateDownloadError } from "./update-download-failure";

/**
 * Report a failed release download (PRODUCT-1727). The shell already retried
 * and resumed it, and keeps the partial on disk for the next poll; what
 * reaches here is the LAST attempt, with the byte position in the message. A
 * `network` failure is the device's link, not a bug: it captures as the quiet
 * `offline` class (one fingerprinted warning issue, burst-collapsed), the way
 * every other transport drop does. An `upstream` failure is the release host
 * answering a transient status for the whole budget (a 504 from GitHub's
 * asset CDN mid-roll, PRODUCT-1811): its own quiet class, tagged with the
 * status, so an outage is one counted issue and never a per-user bug. Both
 * carry the bytes on disk against the total as extras, so one person whose
 * link drops every poll reads as one download inching forward, not as a
 * stack of unrelated failures. Any other class (a final HTTP status, a
 * signature that did not verify, a missing resource) is a real error and
 * files as one.
 */
export function reportUpdateDownloadFailure(
  version: string,
  err: unknown,
): void {
  const error = toUpdateDownloadError(err);
  const command = "update_download";
  const message = `download of ${version} ${error.message}`;
  const progress = {
    received: error.received,
    total: error.total,
    attempts: error.attempts,
  };
  if (error.kind === "network") {
    reportQuietError("offline", command, message, error, progress);
    return;
  }
  if (error.kind === "upstream") {
    reportQuietError(
      "release_host_unavailable",
      command,
      message,
      error,
      progress,
    );
    return;
  }
  reportError(command, message, error);
}
