import { isTurnBusy, TurnFireError } from "../channel/fire-error";
import { AgentRenamingError, LauncherClosedError } from "../ports";
import type { TurnBus } from "../turn/bus";
import type { FireLock } from "./fire-lock";
import { RoutineBusyError, RoutineRunUnrecordedError } from "./run";

/**
 * The burned-instant lock doubles as the instant's outcome ledger: once the
 * fire settles, the lock value becomes its outcome, so a redelivery of the
 * same instant (the control plane timed out waiting, or lost the answer)
 * replays what happened instead of a blind "deduped".
 */
export type FireOutcomeLedger = FireLock & Pick<TurnBus, "get" | "set" | "del">;

/** How one burned instant ended on this host. */
export type FireOutcome =
  | { result: "fired"; startedAt: string }
  | { result: "busy" }
  | { result: "failed"; code: string | null; error: string };

/** The ledger holds a bounded reason: it is a lock value, not a log. */
const MAX_ERROR_CHARS = 1000;

export function encodeFireOutcome(outcome: FireOutcome): string {
  if (outcome.result !== "failed") return JSON.stringify(outcome);
  return JSON.stringify({
    ...outcome,
    error: outcome.error.slice(0, MAX_ERROR_CHARS),
  });
}

/**
 * The recorded outcome, or null when there is none to replay: the first
 * attempt is still running, or the instant was burned by the local scheduler
 * or a host that predates the ledger (both write "1").
 */
export function decodeFireOutcome(value: string | null): FireOutcome | null {
  if (!value || value === "1") return null;
  try {
    const parsed = JSON.parse(value) as Partial<FireOutcome> | null;
    if (parsed?.result === "fired" && typeof parsed.startedAt === "string")
      return { result: "fired", startedAt: parsed.startedAt };
    if (parsed?.result === "busy") return { result: "busy" };
    if (parsed?.result === "failed" && typeof parsed.error === "string")
      return {
        result: "failed",
        code: typeof parsed.code === "string" ? parsed.code : null,
        error: parsed.error,
      };
  } catch {
    // Not JSON: an unknown writer. Nothing to replay; the caller answers the
    // plain deduped shape every control plane understands.
  }
  return null;
}

/**
 * A fire that failed because of where it ran, not what it is: the host is
 * draining or mid-rename (the replacement pod or the new id will take it), the
 * runtime could not be reached (undici's bare `fetch failed`), or no errored
 * run could be recorded for the person to see. The instant must stay
 * deliverable, so the caller releases the burn and answers 503.
 *
 * A `fetch failed` can follow a request the runtime did receive; a redelivery
 * then meets the runtime's busy turn slot or the routine's busy gate rather
 * than starting a second turn.
 */
export function isRetryableFireError(err: unknown): boolean {
  return (
    err instanceof LauncherClosedError ||
    err instanceof AgentRenamingError ||
    err instanceof RoutineRunUnrecordedError ||
    (err instanceof TypeError && err.message === "fetch failed")
  );
}

/** The terminal outcome of a fire that threw and is not retryable. */
export function unfiredOutcome(error: unknown): FireOutcome {
  if (error instanceof RoutineBusyError || isTurnBusy(error))
    return { result: "busy" };
  return {
    result: "failed",
    code: error instanceof TurnFireError ? error.code : null,
    error: error instanceof Error ? error.message : String(error),
  };
}
