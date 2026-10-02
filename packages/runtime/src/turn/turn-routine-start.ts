import type { ObjectStore } from "@houston/runtime-client/object-sync";
import type { TurnServerDeps } from "./server-types";
import { mutateTurnDocument } from "./turn-doc-cas";
import { type TurnFilesystem, turnRoutineRunsKey } from "./turn-filesystem";
import {
  prepareRoutineTurn,
  type RoutinePhase,
  RoutineTurnError,
} from "./turn-routine";
import { publishTurnRunsDoc } from "./turn-runs-doc";
import { docNotLandedReason } from "./turn-view-publish";
import type { TurnRequest } from "./types";

/**
 * Start a pooled routine run against the STORE's run history, not only the
 * hydrated copy: the runs gate reads the history refreshed and merged by run
 * id, and the running row is uploaded under its generation before the turn
 * runs, then projected into the run history doc. While the run executes the
 * app shows it (and its Stop button), and an overlapping fire of the routine
 * in another sandbox meets it at the gate. A sandbox that dies leaves the
 * row running; the control plane's reconcile op settles it once (the gate
 * ignores it past ROUTINE_RUN_TIMEOUT_MS meanwhile). A store that cannot
 * take the row costs only the early view: the run starts from the hydrated
 * copy, as before, and its row lands settled with the run.
 */
export async function startRoutineRun(input: {
  deps: TurnServerDeps;
  turn: TurnRequest;
  turnId: string;
  filesystem: TurnFilesystem;
  resolved: { store: ObjectStore; prefix: string };
  nowIso: string;
}): Promise<RoutinePhase> {
  const { filesystem, turn, turnId, nowIso } = input;
  const prepare = () =>
    prepareRoutineTurn(filesystem.workspaceDir, turn, turnId, nowIso);
  let phase: RoutinePhase;
  try {
    phase = await mutateTurnDocument({
      store: input.resolved.store,
      prefix: input.resolved.prefix,
      filesystem,
      relativePath: turnRoutineRunsKey(filesystem.workspaceRel),
      apply: prepare,
    });
  } catch (error) {
    if (error instanceof RoutineTurnError) throw error;
    console.warn(
      `[turn] routine run ${turnId} not published at start, it lands with the run: ${error instanceof Error ? error.message : String(error)}`,
    );
    return prepare();
  }
  const published = await publishTurnRunsDoc(
    input.deps,
    { ...turn, turnId },
    filesystem,
  );
  const failed = published ? docNotLandedReason(published) : null;
  if (failed)
    console.warn(
      `[turn] routine run ${turnId} row is in the store, its doc lags until the run ends: ${failed}`,
    );
  return phase;
}
