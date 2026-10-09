import type { ModelCallReport } from "@houston/protocol";
import type { WireFrame } from "@houston/runtime-client";
import type { TurnDurabilityResult } from "./turn-durability";
import type { TurnSetupError } from "./turn-layout";
import type { MissionTitleReport } from "./turn-mission-title-outcome";
import type { TurnOutcome } from "./turn-session";
import type { TurnSyncReport } from "./turn-sync-report";

/** Per-turn diagnostics that ride the terminal frame beside `changed`. */
export interface TurnTerminalDiagnostics {
  missionTitle?: MissionTitleReport;
  sync?: TurnSyncReport;
  modelCalls?: ModelCallReport;
}

/**
 * Build the durable terminal frame after sync-back completes. `changed` lists
 * the domain events the landed writes imply; the gateway fans them out to
 * every member's /v1/events, the pod-event parity for a worker-run turn. It
 * rides the error frame too: a provider failure after a durable tool write
 * still changed what other tabs show.
 */
/** performance.now() marks → whole-ms deltas from the earliest mark. */
function timingDeltas(
  marks: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const entries = Object.entries(marks ?? {});
  if (entries.length === 0) return undefined;
  const base = Math.min(...entries.map(([, v]) => v));
  return Object.fromEntries(
    entries.map(([k, v]) => [k.replace(/^t_/, ""), Math.round(v - base)]),
  );
}

export function turnTerminalFrame(
  outcome: TurnOutcome,
  turnId: string,
  poolWritesOutOfScope: number,
  transcriptSkipped?: "route_absent",
  activityDocSkipped?: "route_absent",
  changed: readonly string[] = [],
  timings?: Record<string, number>,
  hydration?: { hydratedObjects: number; skippedObjects: number },
  extra: TurnTerminalDiagnostics = {},
): WireFrame {
  const timingsMs = timingDeltas(timings);
  const { missionTitle, sync, modelCalls } = extra;
  // The worker's pre-prompt cost is its own request-to-prompt span: the
  // earliest mark is the request's arrival.
  const prePrompt = timingsMs?.prompt_start;
  const fields = {
    ...(timingsMs ? { timingsMs } : {}),
    ...(changed.length > 0 ? { changed } : {}),
    ...(poolWritesOutOfScope > 0 ? { poolWritesOutOfScope } : {}),
    ...(transcriptSkipped ? { transcriptSkipped } : {}),
    ...(activityDocSkipped ? { activityDocSkipped } : {}),
    ...hydration,
    ...(missionTitle ? { missionTitle } : {}),
    ...(sync?.incomplete ? { syncIncomplete: sync.incomplete } : {}),
    ...(sync?.merges ? { syncMerges: sync.merges } : {}),
    ...(modelCalls
      ? {
          modelCalls:
            prePrompt === undefined
              ? modelCalls
              : {
                  ...modelCalls,
                  startupMs: { ...modelCalls.startupMs, pre_prompt: prePrompt },
                },
        }
      : {}),
  };
  const diagnostic = Object.keys(fields).length > 0 ? fields : undefined;
  if (outcome.error) {
    // SAFETY: pooled-turn diagnostics are an additive internal transport field;
    // public WireFrame consumers still receive the required error message.
    return {
      type: "error",
      data: { message: outcome.error, ...diagnostic },
      turnId,
    } as WireFrame;
  }
  // SAFETY: claimed-turn diagnostics intentionally widen this internal done
  // frame while preserving null for every ordinary public-protocol turn.
  return {
    type: "done",
    data: diagnostic ?? null,
    turnId,
    ...(outcome.pendingInteraction
      ? { pendingInteraction: outcome.pendingInteraction }
      : {}),
  } as unknown as WireFrame;
}

/** The terminal frame of a turn whose durability pass ran. */
export function durableTerminalFrame(
  durable: TurnDurabilityResult,
  turnId: string,
  timings: Record<string, number>,
  hydration: { hydratedObjects: number; skippedObjects: number },
  missionTitle?: MissionTitleReport,
  modelCalls?: ModelCallReport,
): WireFrame {
  return turnTerminalFrame(
    durable.outcome,
    turnId,
    durable.poolWritesOutOfScope,
    durable.transcriptSkipped,
    durable.activityDocSkipped,
    durable.changed,
    timings,
    hydration,
    {
      ...(missionTitle ? { missionTitle } : {}),
      ...(durable.sync ? { sync: durable.sync } : {}),
      ...(modelCalls ? { modelCalls } : {}),
    },
  );
}

/**
 * The setup frame's `message`: a client that knows no setup code shows it
 * verbatim, so it is a neutral sentence and never the bare code (H-003).
 */
export const TURN_SETUP_FAILED_MESSAGE =
  "Your agent couldn't get ready for this message. Send it again in a moment.";

/** Build the internal typed error frame for pre-provider setup failures. */
export function turnSetupErrorFrame(
  error: TurnSetupError,
  turnId: string,
): WireFrame {
  // SAFETY: setup error codes are internal to the pool dispatcher and retain
  // the public error frame's required message field. Readers (the gateway,
  // the SDK) key on `code`, never on the message.
  return {
    type: "error",
    data: {
      message: TURN_SETUP_FAILED_MESSAGE,
      code: error.code,
      detail: error.message,
    },
    turnId,
  } as WireFrame;
}
