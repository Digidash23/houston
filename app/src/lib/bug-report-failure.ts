// The typed failure the bug-report intake rejects with: the shell's
// `report_bug` (app/src-tauri/src/bug_report/failure.rs) and, on web, the
// shim's reading of the gateway's `503 {code: "intake_unavailable"}`.
// Dependency-free so it is node-testable directly
// (app/tests/bug-report-failure.test.ts).

/**
 * `intake_unavailable`: Linear is refusing every report for a reason on our
 * side (the workspace's plan issue cap, HOUSTON-APP-5FT; a rate limit; an
 * outage). Retrying cannot help the person, so the report goes through the
 * fallback channel and the refusal is a quiet class, never a per-user bug.
 */
export type BugReportFailureKind = "intake_unavailable" | "other";

export interface BugReportFailure {
  kind: BugReportFailureKind;
  /** The raw diagnostic. Log it, never show it. */
  message: string;
}

const KINDS: ReadonlySet<string> = new Set(["intake_unavailable", "other"]);

/**
 * Read an intake rejection into a `BugReportFailure`. A plain string (an
 * older shell) or a thrown `Error` with no kind is `other`, so the caller
 * never branches on the raw shape.
 */
export function toBugReportFailure(err: unknown): BugReportFailure {
  if (err !== null && typeof err === "object" && "kind" in err) {
    const raw = err as Record<string, unknown>;
    if (typeof raw.kind === "string" && KINDS.has(raw.kind)) {
      return {
        kind: raw.kind as BugReportFailureKind,
        message: typeof raw.message === "string" ? raw.message : "",
      };
    }
  }
  return {
    kind: "other",
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * The intake's rejection as an Error, so the layers that only understand
 * Errors (the frontend log line, Sentry's report error, a `cause` chain) see
 * the diagnostic instead of `[object Object]`, while `toBugReportFailure`
 * still reads `kind` off it. `osReportBug` mints it.
 */
export class BugReportError extends Error {
  readonly kind: BugReportFailureKind;

  constructor(failure: BugReportFailure) {
    super(failure.message);
    this.name = "BugReportError";
    this.kind = failure.kind;
  }
}

/** Linear refusing every report on our side, off any shape of the rejection. */
export function isBugIntakeUnavailable(err: unknown): boolean {
  return toBugReportFailure(err).kind === "intake_unavailable";
}
