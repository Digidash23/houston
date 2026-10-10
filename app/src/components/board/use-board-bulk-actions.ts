import type { KanbanItem } from "@houston-ai/board";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { fireMissionDoneConfetti } from "../../lib/confetti";
import {
  celebratesMissionDone,
  DONE_STATUS,
  moveTargetsForSection,
} from "../../lib/mission-selection";
import type { BoardSelectionModel } from "./board-selection-model";

/**
 * The floating bulk-action-bar config for a {@link BoardSelectionModel}: move
 * targets for the locked section, move / archive / delete dispatch (each
 * paints now; a refusal toasts from the write itself), and the bar's labels.
 * `undefined` without a selection model.
 */
export function useBoardBulkActions({
  selection,
  selectionLockColumnId,
  allItems,
  openChatId,
  onCloseOpenChat,
}: {
  selection?: BoardSelectionModel;
  selectionLockColumnId: string | null;
  allItems: KanbanItem[];
  openChatId?: string | null;
  onCloseOpenChat?: () => void;
}) {
  const { t } = useTranslation(["board", "dashboard"]);

  // A removal takes its cards off the board in the same frame as the click,
  // so the open chat's panel closes with them (membership is read before the
  // op, which clears the selection set). A refusal brings the cards back
  // with its own toast; the panel stays closed.
  const runRemoval = useCallback(
    (op: () => void) => {
      const closesOpenChat =
        openChatId != null && selection?.selectedIds.has(openChatId);
      op();
      if (closesOpenChat) onCloseOpenChat?.();
    },
    [selection, openChatId, onCloseOpenChat],
  );

  return useMemo(() => {
    if (!selection) return undefined;
    return {
      moveTargets: moveTargetsForSection(selectionLockColumnId).map(
        (status) => ({
          status,
          label:
            status === DONE_STATUS
              ? t("dashboard:columns.done")
              : t("dashboard:columns.needsYou"),
        }),
      ),
      // One celebration for the whole batch, fired with the move it paints
      // (the single-card checkmark's rule, `armMissionDoneCelebration`). The
      // statuses are read BEFORE the move rewrites them and clears the
      // selection: a Needs you selection can mix settled and failed missions,
      // so the batch celebrates when at least one of them succeeded, and a
      // batch of nothing but failures moves in silence. No card origin: a bulk
      // move finishes many cards at once, so the burst keeps the default rise
      // from the bottom of the board.
      onMove: (status: string) => {
        const fromStatuses = allItems
          .filter((a) => selection.selectedIds.has(a.id))
          .map((a) => a.status);
        selection.move(status);
        if (celebratesMissionDone(status, fromStatuses))
          fireMissionDoneConfetti();
      },
      onArchive: () => runRemoval(selection.archive),
      onDelete: () => runRemoval(selection.remove),
      onClear: selection.clear,
      labels: {
        selected: (count: number) => t("board:bulk.selected", { count }),
        moveTo: t("board:bulk.moveTo"),
        archive: t("board:bulk.archive"),
        delete: t("board:bulk.delete"),
        clear: t("board:bulk.clear"),
        cancel: t("board:bulk.cancel"),
        confirmMoveTitle: t("board:bulk.confirmMove.title"),
        confirmMoveDescription: (count: number, target: string) =>
          t("board:bulk.confirmMove.description", { count, target }),
        confirmMoveAction: t("board:bulk.confirmMove.action"),
        confirmArchiveTitle: t("board:bulk.confirmArchive.title"),
        confirmArchiveDescription: (count: number) =>
          t("board:bulk.confirmArchive.description", { count }),
        confirmArchiveAction: t("board:bulk.confirmArchive.action"),
        confirmDeleteTitle: t("board:bulk.confirmDelete.title"),
        confirmDeleteDescription: (count: number) =>
          t("board:bulk.confirmDelete.description", { count }),
        confirmDeleteAction: t("board:bulk.confirmDelete.action"),
      },
    };
  }, [selection, selectionLockColumnId, allItems, runRemoval, t]);
}
