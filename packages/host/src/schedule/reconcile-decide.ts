import { completeRoutineRun, ROUTINE_RUN_TIMEOUT_MS } from "@houston/domain";
import type { ChatMessage, Routine, RoutineRun } from "@houston/protocol";
import {
  providerErrorSummary,
  routineRunFailure,
  routineRunFailureSummary,
} from "./run-failure";

/** The run-row sentence for a run whose turn died before it finished. */
export const INTERRUPTED_RUN_SUMMARY =
  "The routine was interrupted before it finished.";

/** One sweep's decision for a run, applied only if the row is still `running`. */
export interface RunUpdate {
  run: RoutineRun;
  /**
   * A NON-terminal field write. `run` is a snapshot taken before this sweep's
   * awaits, so writing it back would revert whatever else changed on a row
   * that stays `running` (a pause, an activity id). A patch is merged onto the
   * FRESH row instead. Terminal updates keep replacing the row wholesale:
   * there, the snapshot IS the decision and nothing may survive it.
   */
  patch?: Partial<RoutineRun>;
  /** Set when the update surfaces content — drives the board Activity. */
  surfacedRoutine?: Routine;
}

/**
 * What a sweep does with one running run: leave it in flight, record a
 * resume (no completion lock: the resumed turn's real reply must still win it
 * on a later sweep), or settle it (one replica owns that, under the lock).
 */
export type RunDecision =
  | { kind: "wait" }
  | { kind: "patch"; update: RunUpdate }
  | { kind: "settle"; update: RunUpdate };

export function decideRun(input: {
  run: RoutineRun;
  routine: Routine;
  reply: ChatMessage | null;
  nowMs: number;
  nowIso: string;
  /** The run's turn is known dead: no reply is coming, and a resume never. */
  abandoned: boolean;
}): RunDecision {
  const { run, routine, nowIso } = input;
  // A dead pooled turn is known by its id (a pooled run's id IS its turn id):
  // in a shared chat, a later turn's reply is that turn's, never this run's.
  const reply =
    input.abandoned &&
    input.reply?.turnId !== undefined &&
    input.reply.turnId !== run.id
      ? null
      : input.reply;
  // A dead turn's only reply is its interruption line (or none at all): the
  // run is over, and waiting out the timeout would only delay saying so.
  if (input.abandoned && (!reply || reply.interrupted !== undefined)) {
    return settle({
      ...run,
      status: "error",
      summary: INTERRUPTED_RUN_SUMMARY,
      completed_at: nowIso,
    });
  }
  // An `interrupted.resumed` reply is the engine saying "I died mid-run and
  // am running this turn again myself" (PRODUCT-1785) — a pause, not the
  // run's answer. Its 15-minute budget restarts from that interruption: the
  // work began again there, and timing it out against the ORIGINAL start
  // would kill a resume that only had seconds of the first window left.
  const resumedReply = reply?.interrupted?.resumed === true ? reply : null;
  const clockStartMs = resumedReply
    ? resumedReply.ts
    : Date.parse(run.started_at);
  const timedOut =
    (!reply || resumedReply !== null) &&
    input.nowMs - clockStartMs > ROUTINE_RUN_TIMEOUT_MS;
  if (timedOut) {
    return settle({
      ...run,
      status: "error",
      summary: "The routine timed out without a response.",
      completed_at: nowIso,
    });
  }
  if (!reply) return { kind: "wait" }; // turn still in flight
  if (resumedReply) {
    // Writing the same flag from two replicas is idempotent.
    return run.resumed
      ? { kind: "wait" }
      : { kind: "patch", update: { run, patch: { resumed: true } } };
  }

  // A failed turn (auth, rate limit, bad pin…) persists its typed provider
  // error on the assistant message — surface THAT as the run's error right
  // now (parity with the Rust dispatcher's visible run errors) instead of
  // classifying the empty reply or waiting out the 15-minute timeout.
  if (reply.providerError) {
    // A credential-level wall gets the honest, whose-account-is-it sentence
    // (PRODUCT-1475): the raw provider message says "no provider connected"
    // to a reader whose OWN account is connected. Everything else keeps the
    // verbatim provider text.
    const failure = routineRunFailure(reply.providerError);
    return settle({
      ...run,
      status: "error",
      summary: failure
        ? routineRunFailureSummary(failure)
        : providerErrorSummary(reply.providerError),
      ...(failure ? { failure } : {}),
      completed_at: nowIso,
    });
  }

  const done = completeRoutineRun(run, routine, reply.content, nowIso);
  return {
    kind: "settle",
    update: {
      run: done,
      surfacedRoutine: done.status === "surfaced" ? routine : undefined,
    },
  };
}

const settle = (run: RoutineRun): RunDecision => ({
  kind: "settle",
  update: { run },
});
