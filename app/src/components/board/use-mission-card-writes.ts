import type { KanbanItem } from "@houston-ai/board";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { armMissionDoneCelebration } from "../../lib/mission-done-celebration";
import { ARCHIVED_STATUS, DONE_STATUS } from "../../lib/mission-selection";
import {
  deleteMission,
  editMission,
  moveFailure,
  renameFailure,
} from "./mission-writes";

/**
 * Mission Control's single-card writes: delete, the checkmark, the archive
 * box and rename. Each paints now and runs behind the click
 * (`mission-writes.ts`), so the card leaves, moves or renames in this frame
 * and a refusal brings it back with a toast. A card that leaves the board
 * closes its open chat in the same frame.
 */
export function useMissionCardWrites({
  agentPathOf,
  selectedId,
  setSelectedId,
}: {
  /** The owning agent of a card on this board, by activity id. */
  agentPathOf: (id: string) => string | undefined;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}) {
  const qc = useQueryClient();

  const handleDelete = useCallback(
    (item: KanbanItem) => {
      const agentPath = agentPathOf(item.id);
      if (!agentPath) return;
      void deleteMission(qc, agentPath, item, "board");
      if (selectedId === item.id) setSelectedId(null);
    },
    [qc, agentPathOf, selectedId, setSelectedId],
  );

  // The user signing a mission off. Failed missions get the move without the
  // fanfare (`armMissionDoneCelebration` decides, and says why the burst
  // fires with the paint rather than the host's answer).
  const handleApprove = useCallback(
    (item: KanbanItem) => {
      const agentPath = agentPathOf(item.id);
      if (!agentPath) return;
      const celebrate = armMissionDoneCelebration(item, DONE_STATUS);
      void editMission(
        qc,
        agentPath,
        item,
        { status: DONE_STATUS },
        { command: "approve_mission", failure: moveFailure(item, "move") },
      );
      celebrate();
    },
    [qc, agentPathOf],
  );

  // Filing away a mission the user already signed off. No confetti: the win
  // was the checkmark.
  const handleArchive = useCallback(
    (item: KanbanItem) => {
      const agentPath = agentPathOf(item.id);
      if (!agentPath) return;
      void editMission(
        qc,
        agentPath,
        item,
        { status: ARCHIVED_STATUS },
        { command: "archive_mission", failure: moveFailure(item, "archive") },
      );
      if (selectedId === item.id) setSelectedId(null);
    },
    [qc, agentPathOf, selectedId, setSelectedId],
  );

  const handleRename = useCallback(
    (item: KanbanItem, newTitle: string) => {
      const agentPath = agentPathOf(item.id);
      if (!agentPath) return;
      void editMission(
        qc,
        agentPath,
        item,
        { title: newTitle },
        { command: "rename_mission", failure: renameFailure(item) },
      );
    },
    [qc, agentPathOf],
  );

  return { handleDelete, handleApprove, handleArchive, handleRename };
}
