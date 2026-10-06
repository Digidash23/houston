import {
  routineAutoPauseLogTail,
  unconnectedRoutineFailure,
} from "@houston/domain";
import type { RoutineRunFailure } from "@houston/protocol";
import type { ObjectStore } from "@houston/runtime-client/object-sync";
import { type TurnFilesystem, turnRoutineRunsKey } from "./turn-filesystem";
import { type RoutinePhase, settleRoutineTurn } from "./turn-routine";
import { autoPauseRoutineTurn } from "./turn-routine-auto-pause";

/** A settled routine turn: an error for the outcome, and its pending pause. */
export interface FinishedRoutineTurn {
  error?: string;
  /**
   * The auto-pause, for the caller to run after sync-back with the keys it
   * landed. Overlapping runs of the routine settle in other sandboxes, and
   * only the merged history the sync-back leaves on disk holds their rows.
   * Resolves to an error to append to the turn's outcome.
   */
  afterSync?: (landed: readonly string[]) => Promise<string | undefined>;
}

/**
 * A routine turn's terminal step: settle its run row, and when the run failed
 * on a typed wall hand back the pause check for after the sync-back. A failed
 * pause is reported, never swallowed: the run row already landed, and the next
 * failed run retries it.
 */
export async function finishRoutineTurn(opts: {
  store: ObjectStore;
  prefix: string;
  filesystem: TurnFilesystem;
  phase: RoutinePhase;
  conversationId: string;
  turnError?: string;
  /**
   * The turn never reached a provider: nothing was connected to run it on.
   * `provider` is what the turn would have run on; absent when nothing named
   * one (an unpinned routine).
   */
  unconnected?: { provider?: string } | undefined;
}): Promise<FinishedRoutineTurn> {
  // Same rule as the standing fire path (schedule/run.ts).
  const failure: RoutineRunFailure | undefined = opts.unconnected
    ? unconnectedRoutineFailure(opts.unconnected.provider)
    : undefined;
  let settled: Awaited<ReturnType<typeof settleRoutineTurn>>;
  try {
    settled = await settleRoutineTurn({
      workspaceDir: opts.filesystem.workspaceDir,
      phase: opts.phase,
      conversationId: opts.conversationId,
      ...(opts.turnError ? { turnError: opts.turnError } : {}),
      ...(failure ? { failure } : {}),
      nowIso: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
  } catch (error) {
    return {
      error: `routine settle failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!settled?.failure) return {};
  const runsKey = turnRoutineRunsKey(opts.filesystem.workspaceRel);
  return {
    afterSync: async (landed) => {
      // This run's row is not durable: the next failed run decides instead.
      if (!landed.includes(runsKey)) return undefined;
      return pauseIfEarned(opts);
    },
  };
}

async function pauseIfEarned(opts: {
  store: ObjectStore;
  prefix: string;
  filesystem: TurnFilesystem;
  phase: RoutinePhase;
}): Promise<string | undefined> {
  try {
    const paused = await autoPauseRoutineTurn({
      store: opts.store,
      prefix: opts.prefix,
      filesystem: opts.filesystem,
      routineId: opts.phase.routine.id,
      nowIso: new Date().toISOString(),
    });
    if (paused)
      console.info(
        `[routine-auto-pause] paused ${paused.id} after ${routineAutoPauseLogTail(paused.auto_paused)}`,
      );
    return undefined;
  } catch (error) {
    return `routine auto-pause failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
