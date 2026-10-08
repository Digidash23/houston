import {
  isTurnBusy,
  TurnDeliveryUncertainError,
  TurnFireError,
} from "../channel/fire-error";
import { AgentRenamingError, LauncherClosedError } from "../ports";
import type { TurnBus } from "../turn/bus";
import type { FireLock } from "./fire-lock";
import { RoutineBusyError, RoutineRunUnrecordedError } from "./run";
import { isUnconnectedRefusal } from "./run-failure";

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

/**
 * What a fresh burn writes: the instant's first delivery is still firing. A
 * redelivery meeting it must not read it as a success (the first attempt may
 * yet fail), so it is answered 503 and retried. The local scan and older
 * hosts burn "1", which decodes as nothing to replay.
 */
export const FIRE_IN_FLIGHT = JSON.stringify({ result: "pending" });

/** A ledger entry: the instant's recorded outcome, or its fire in flight. */
export type FireLedgerEntry = FireOutcome | { result: "pending" };

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
 * The recorded entry, or null when there is none to replay: the instant was
 * burned by the local scheduler or a host that predates the ledger (both
 * write "1").
 */
export function decodeFireOutcome(
  value: string | null,
): FireLedgerEntry | null {
  if (!value || value === "1") return null;
  try {
    const parsed = JSON.parse(value) as Partial<FireLedgerEntry> | null;
    if (parsed?.result === "pending") return { result: "pending" };
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
 * runtime could not be reached or refused to start the turn (its 503 while it
 * drains), or no errored run could be recorded for the person to see. The
 * instant must stay deliverable, so the caller releases the burn and answers
 * 503.
 *
 * A raw `fetch failed` reaching here never came from the turn POST itself:
 * ProxyChannel lets only a dial failure through and wraps any other failure
 * of that POST in TurnDeliveryUncertainError (the runtime may already be
 * running the turn, so it is never redelivered unless the host's drain had
 * already stopped that runtime). The rest come from waking the runtime or
 * preparing the turn, before any message was sent.
 */
export function isRetryableFireError(err: unknown): boolean {
  return (
    err instanceof LauncherClosedError ||
    err instanceof AgentRenamingError ||
    err instanceof RoutineRunUnrecordedError ||
    (err instanceof TurnDeliveryUncertainError && err.hostShuttingDown) ||
    (err instanceof TurnFireError && err.status === 503) ||
    (err instanceof TypeError && err.message === "fetch failed")
  );
}

/** The terminal outcome of a fire that threw and is not retryable. */
export function unfiredOutcome(
  error: unknown,
): Exclude<FireOutcome, { result: "fired" }> {
  if (error instanceof RoutineBusyError || isTurnBusy(error))
    return { result: "busy" };
  return {
    result: "failed",
    code: error instanceof TurnFireError ? error.code : null,
    error: error instanceof Error ? error.message : String(error),
  };
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Log a delivered instant that did not fire. On the host only console.error
 * becomes a Sentry event (local/main.ts), so a fault goes out at error level
 * and an expected state as a warning breadcrumb, as in the local scan
 * (agent-scan.ts). Expected: a turn already running, a creator with nothing
 * connected (the errored run says so and the routine pauses), and a deferral
 * the host's drain or a rename caused. A deferral because the run history
 * could not be written is a fault even though the instant is redelivered.
 */
export function reportUnfiredFire(
  routineId: string,
  error: unknown,
  deferred: boolean,
): void {
  const tag = `[routine-fires] routine ${routineId}`;
  if (deferred) {
    if (error instanceof RoutineRunUnrecordedError)
      console.error(`${tag} fire deferred, its run unrecorded:`, error);
    else console.warn(`${tag} fire deferred: ${messageOf(error)}`);
    return;
  }
  const outcome = unfiredOutcome(error);
  if (outcome.result === "busy") {
    console.warn(`${tag} skipped: ${messageOf(error)}`);
    return;
  }
  const failed = `${tag} fire failed (${outcome.code ?? "uncoded"})`;
  if (isUnconnectedRefusal(error)) console.warn(`${failed}: ${outcome.error}`);
  else console.error(`${failed}:`, error);
}
