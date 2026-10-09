import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ARCHIVED_STATUS } from "../../lib/mission-selection";
import type { BoardSelectionModel } from "./board-selection-model";
import { groupIdsByAgent } from "./group-ids-by-agent";
import { deleteMissions, editMissions } from "./mission-writes";
import { useSelectionSet } from "./use-selection-set";

/**
 * Cross-agent multi-select + bulk actions for Mission Control.
 *
 * The board spans every agent, but each `tauriActivity.bulkUpdate` /
 * `bulkDelete` call is scoped to a single agent. So a bulk action groups the
 * selection by owning agent ({@link groupIdsByAgent}) and fans out one call
 * per agent behind an optimistic paint (`mission-writes.ts`): the cards move
 * or leave and the selection clears in the same frame as the click, and a
 * refusal brings them back with one toast.
 */
export function useCrossAgentSelection({
  paths,
  agentPathForId,
}: {
  /** Every agent path on the Mission Control view (for query invalidation). */
  paths: string[];
  /** Resolve a mission id to its owning agent path. */
  agentPathForId: (id: string) => string | undefined;
}): BoardSelectionModel {
  const { selectedIds, toggle, selectAll, clear } = useSelectionSet();
  const qc = useQueryClient();

  const groups = useCallback(
    () => groupIdsByAgent(Array.from(selectedIds), agentPathForId),
    [selectedIds, agentPathForId],
  );

  const move = useCallback(
    (status: string) => {
      void editMissions(qc, groups(), paths, status, "move");
      clear();
    },
    [qc, groups, paths, clear],
  );

  const archive = useCallback(() => {
    void editMissions(qc, groups(), paths, ARCHIVED_STATUS, "archive");
    clear();
  }, [qc, groups, paths, clear]);

  const remove = useCallback(() => {
    void deleteMissions(qc, groups(), paths);
    clear();
  }, [qc, groups, paths, clear]);

  return { selectedIds, toggle, selectAll, clear, move, archive, remove };
}
