import type { RoutineRunFailure } from "@houston/protocol";
import type { ObjectStore } from "@houston/runtime-client/object-sync";
import type { TurnFilesystem } from "./turn-filesystem";
import { type RoutinePhase, settleRoutineTurn } from "./turn-routine";
import { autoPauseRoutineTurn } from "./turn-routine-auto-pause";

/**
 * A routine turn's terminal step: settle its run row, then pause the routine
 * when that failure completed a streak. Resolves to an error to append to the
 * turn's outcome, or undefined. A failed pause is reported that way too, never
 * swallowed: the run row already landed, and the next failed run retries it.
 */
export async function finishRoutineTurn(opts: {
  store: ObjectStore;
  prefix: string;
  filesystem: TurnFilesystem;
  phase: RoutinePhase;
  conversationId: string;
  turnError?: string;
  /** The turn never reached a provider: nothing was connected to run it on. */
  unconnectedProvider?: string;
}): Promise<string | undefined> {
  // Same rule as the standing fire path (schedule/run.ts): only a named
  // provider makes the missing connection a typed failure.
  const failure: RoutineRunFailure | undefined = opts.unconnectedProvider
    ? { code: "creator_not_connected", provider: opts.unconnectedProvider }
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
    return `routine settle failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!settled?.failure) return undefined;
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
        `[routine-auto-pause] paused ${paused.id} after ${paused.auto_paused?.failures} runs: ${paused.auto_paused?.reason} (${paused.auto_paused?.provider})`,
      );
    return undefined;
  } catch (error) {
    return `routine auto-pause failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
