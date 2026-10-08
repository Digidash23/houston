import { EngineError } from "@houston/runtime-client";

/**
 * An import the page left behind, not one the host refused.
 *
 * When a document unloads, the browser aborts its in-flight requests and the
 * rejection looks exactly like a transport drop (a `TypeError`, no response).
 * The onboarding closing used to read that as a failed import and finish
 * onboarding from the dying page, so a reload during the save landed in the
 * app with an empty manager chat (PRODUCT-2040). An import that ends this
 * way is still owed on the device and is sent again on the next load; the
 * caller must not act on it as a failure, and nothing reports it.
 */
export class ConversationImportAbortedError extends Error {
  /** `AbortError`, the name every error-surfacing policy already treats as
   *  an expected cancellation: no toast, no report. */
  override readonly name = "AbortError";
  readonly reason = "unload" as const;
  constructor(cause: unknown) {
    super("conversation import aborted: the page is unloading", { cause });
  }
}

export function isConversationImportAborted(
  err: unknown,
): err is ConversationImportAbortedError {
  return err instanceof ConversationImportAbortedError;
}

export type ImportFailureKind = "aborted" | "failed";

/**
 * How an import's rejection is read. `aborted` when the request itself was
 * cancelled (an `AbortError`), or when the host never answered while the page
 * was unloading: an {@link EngineError} IS an answer, so it stays a failure
 * whatever the page is doing. Everything else is a failure the caller owns.
 */
export function classifyImportFailure(
  err: unknown,
  unloading: boolean,
): ImportFailureKind {
  if (err instanceof EngineError) return "failed";
  if (err instanceof Error && err.name === "AbortError") return "aborted";
  return unloading ? "aborted" : "failed";
}
