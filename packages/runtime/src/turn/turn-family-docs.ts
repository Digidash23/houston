import { docKey } from "@houston/domain";
import type { TurnServerDeps } from "./server-types";
import type { ActivityDocPublishResult } from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import { type TurnFilesystem, turnRoutineRunsKey } from "./turn-filesystem";
import { publishTurnLearningsDoc } from "./turn-learnings-doc";
import { publishTurnRoutinesDoc } from "./turn-routines-doc";
import { publishTurnRunsDoc } from "./turn-runs-doc";
import type { TurnRequest } from "./types";

type Turn = TurnRequest & { turnId: string };

type FamilyEvent =
  | "RoutinesChanged"
  | "RoutineRunsChanged"
  | "LearningsChanged";

/**
 * Project every family file a claimed turn landed (`landed` = uploaded plus
 * immediate writes) into its doc: the routine run history, the routines and
 * the memories. Resolves to the errors to append to the turn's outcome and
 * the events that must not be announced: an event promises the refetch can
 * be served asleep, which a doc that did not land breaks.
 */
export async function publishLandedFamilyDocs(input: {
  deps: TurnServerDeps;
  turn: Turn;
  filesystem: TurnFilesystem;
  source: ActivityDocSource;
  landed: readonly string[];
}): Promise<{ errors: string[]; stale: FamilyEvent[] }> {
  const { deps, turn, filesystem } = input;
  const errors: string[] = [];
  const stale: FamilyEvent[] = [];
  const settle = (
    event: FamilyEvent,
    label: string,
    result: ActivityDocPublishResult | null,
  ) => {
    if (result && "error" in result)
      errors.push(`${label} doc publish failed: ${result.error}`);
    if (!result || "error" in result || "skipped" in result) stale.push(event);
  };
  if (input.landed.includes(turnRoutineRunsKey(filesystem.workspaceRel))) {
    // The runs doc is projected for routine fires only; any other turn that
    // touched it has no doc to point other tabs at.
    const runs =
      turn.claim && turn.routine
        ? await publishTurnRunsDoc(deps, turn, filesystem)
        : null;
    settle("RoutineRunsChanged", "runs", runs);
  }
  // No doc system to project into (unclaimed, no pool store): these events
  // stand as they always have, since reads there never come from the doc.
  if (input.landed.includes(docKey(filesystem.workspaceRel, "routines"))) {
    const routines = turn.claim
      ? await publishTurnRoutinesDoc(deps, turn, filesystem, input.source)
      : null;
    if (routines) settle("RoutinesChanged", "routines", routines);
  }
  if (input.landed.includes(docKey(filesystem.workspaceRel, "learnings"))) {
    const learnings = await publishTurnLearningsDoc(
      deps,
      turn,
      filesystem,
      input.source,
    );
    if (learnings) settle("LearningsChanged", "learnings", learnings);
  }
  return { errors, stale };
}
