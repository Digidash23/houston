// The one rule for getting a bug report to us (H-009, HOUSTON-APP-5FT).
// Dependency-free (the channels are injected) so it is node-testable directly
// (app/tests/bug-report-delivery.test.ts); `bug-report.ts` wires the real ones.

import {
  type BugReportFailure,
  toBugReportFailure,
} from "./bug-report-failure.ts";

/**
 * Where the report landed. `linear` and `fallback` both mean WE HAVE IT, so
 * both surfaces show their success toast; only `none` (every channel failed)
 * earns a "try again", and the surface keeps whatever the person typed.
 */
export type BugReportOutcome =
  | { delivered: "linear"; issueId: string | null }
  | { delivered: "fallback"; eventId: string }
  | { delivered: "none" };

export interface BugReportChannels {
  /** The primary intake (the shell's Linear call, the gateway on web):
   *  resolves to the issue identifier, rejects with the typed failure. */
  sendToIntake(): Promise<string | null>;
  /** The fallback (Sentry user feedback): the accepted event id, or "" when
   *  it did not land. */
  sendFallback(failure: BugReportFailure): Promise<string>;
  /** Report the intake's refusal: a quiet class for `intake_unavailable`
   *  (the fallback feedback IS the signal), a real error for anything else. */
  reportIntakeFailure(failure: BugReportFailure, err: unknown): void;
  /** Report the fallback itself throwing. A "" answer is not reported: that
   *  is Sentry not taking events, and Sentry is the only place it could go. */
  reportFallbackFailure(err: unknown): void;
}

/**
 * Linear first. On ANY refusal the report still goes out through the
 * fallback: a person who took the time to write to us is never lost to an
 * intake failure, whatever its class. The class only decides how loudly the
 * refusal itself is reported.
 */
export async function deliverBugReport(
  channels: BugReportChannels,
): Promise<BugReportOutcome> {
  let failure: BugReportFailure;
  try {
    return { delivered: "linear", issueId: await channels.sendToIntake() };
  } catch (err) {
    failure = toBugReportFailure(err);
    channels.reportIntakeFailure(failure, err);
  }
  try {
    const eventId = await channels.sendFallback(failure);
    if (eventId) return { delivered: "fallback", eventId };
  } catch (err) {
    channels.reportFallbackFailure(err);
  }
  return { delivered: "none" };
}
