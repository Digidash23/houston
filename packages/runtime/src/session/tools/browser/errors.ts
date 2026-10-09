import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

/** Why a `browser` call did nothing. Reported as a value so the model can react. */
export type BrowserErrorCode =
  /** No usable Chromium-family browser on this machine. */
  | "browser_unavailable"
  /** The call was missing a field its action needs, or named no action. */
  | "invalid_action"
  /** The address is not an ordinary web page (file:, chrome:, this runtime). */
  | "url_refused"
  /** The page refused or timed out (element gone, navigation failed). */
  | "page_error";

export class BrowserToolError extends Error {
  constructor(
    readonly code: BrowserErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BrowserToolError";
  }
}

export interface BrowserFailureDetails {
  ok: false;
  error: { code: BrowserErrorCode; message: string };
}

export interface BrowserSuccessDetails {
  ok: true;
  action: string;
  /** Where the page is now; absent after close. */
  url?: string;
}

export type BrowserDetails = BrowserSuccessDetails | BrowserFailureDetails;

/** A refusal the model reads as one, with its code (`reportsNotDone` keys on ok). */
export function browserFailure(
  code: BrowserErrorCode,
  message: string,
): AgentToolResult<BrowserFailureDetails> {
  return {
    content: [{ type: "text", text: `ERROR ${code}: ${message}` }],
    details: { ok: false, error: { code, message } },
  };
}
