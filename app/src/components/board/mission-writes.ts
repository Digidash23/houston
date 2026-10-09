import type { KanbanItem } from "@houston-ai/board";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { allCachedConversationRows } from "../../lib/cached-conversation-rows";
import {
  forgetConversationDraftsOf,
  forgetDeletedConversationDrafts,
} from "../../lib/conversation-drafts";
import i18n from "../../lib/i18n";
import {
  type MissionEdit,
  type MissionGroups,
  missionEditPatches,
  missionRemovalPatches,
} from "../../lib/mission-cache-patches";
import type { OptimisticFailureCopy } from "../../lib/optimistic-core";
import { optimisticWrite } from "../../lib/optimistic-write";
import { queryKeys } from "../../lib/query-keys";
import { tauriActivity } from "../../lib/tauri";
import { boardItemConversationRow } from "./board-item-row";

/**
 * Every user-initiated mission write, painted in the same frame as the click
 * (`optimisticWrite`: the activity writes ride `call()`): the card
 * leaves, moves or renames now, the host write runs behind it, and only a
 * refusal is visible later, as the card coming back plus one toast saying so.
 * Fire-and-forget: the returned promise never rejects, so no handler awaits
 * it to close a menu or a panel.
 */

/** Where a refused delete puts the card back, for the toast's wording. */
export type MissionHome = "board" | "archive";

/** Keys a single-card write re-reads once it settles: the agent's own list.
 *  The aggregate is left to the agent's event (`patchAgentSlice`), which
 *  re-reads one pod instead of waking every agent's. */
const ownList = (agentPath: string): QueryKey[] => [
  queryKeys.activity(agentPath),
];

const titleOf = (item: KanbanItem) => ({ title: item.title });

/** Delete one card. Its unsent draft goes only once the host confirms, so a
 *  refused delete leaves the user's half-typed message where it was. */
export function deleteMission(
  qc: QueryClient,
  agentPath: string,
  item: KanbanItem,
  home: MissionHome,
): Promise<void> {
  // Read off the card now: after the patch no cache names this conversation.
  const row = boardItemConversationRow(item);
  return optimisticWrite({
    qc,
    command: "delete_mission",
    patches: missionRemovalPatches({ [agentPath]: [item.id] }),
    write: () => tauriActivity.delete(agentPath, item.id),
    invalidate: ownList(agentPath),
    failure: {
      title: i18n.t("board:writeFailed.delete", titleOf(item)),
      description: i18n.t(
        home === "archive"
          ? "board:writeFailed.backInArchive"
          : "board:writeFailed.backOnBoard",
      ),
    },
    onSuccess: () => forgetConversationDraftsOf(row),
  });
}

/** Move (status) or rename (title) one card. */
export function editMission(
  qc: QueryClient,
  agentPath: string,
  item: KanbanItem,
  edit: MissionEdit,
  opts: {
    command: string;
    failure: OptimisticFailureCopy;
    refresh?: QueryKey[];
  },
): Promise<void> {
  return optimisticWrite({
    qc,
    command: opts.command,
    patches: missionEditPatches(
      { [agentPath]: [item.id] },
      edit,
      new Date().toISOString(),
    ),
    write: () => tauriActivity.update(agentPath, item.id, edit),
    invalidate: opts.refresh ?? ownList(agentPath),
    failure: opts.failure,
  });
}

/** The copy for a single card's status move or archive. */
export function moveFailure(
  item: KanbanItem,
  kind: "move" | "archive",
): OptimisticFailureCopy {
  return {
    title: i18n.t(`board:writeFailed.${kind}`, titleOf(item)),
    description: i18n.t(
      kind === "archive"
        ? "board:writeFailed.backOnBoard"
        : "board:writeFailed.backWhereItWas",
    ),
  };
}

/** The copy for a refused rename: named by the title the card has again. */
export function renameFailure(item: KanbanItem): OptimisticFailureCopy {
  return {
    title: i18n.t("board:writeFailed.rename", titleOf(item)),
    description: i18n.t("board:writeFailed.oldName"),
  };
}

/** Refresh after a bulk write: the board's own roster sweep and every touched
 *  agent's list, as the bulk paths always did. */
function bulkRefresh(groups: MissionGroups, paths: string[]): QueryKey[] {
  return [
    queryKeys.allConversations(paths),
    ...Object.keys(groups).map((agentPath) => queryKeys.activity(agentPath)),
  ];
}

/** One request per agent; any refusal rolls the whole batch back, and the
 *  refresh after it restores whatever did land. */
function perAgent(
  groups: MissionGroups,
  call: (agentPath: string, ids: string[]) => Promise<void>,
): () => Promise<void> {
  return async () => {
    await Promise.all(
      Object.entries(groups).map(([agentPath, ids]) =>
        call(agentPath, [...ids]),
      ),
    );
  };
}

/** Delete a cross-agent selection. */
export function deleteMissions(
  qc: QueryClient,
  groups: MissionGroups,
  paths: string[],
): Promise<void> {
  if (Object.keys(groups).length === 0) return Promise.resolve();
  const ids = Object.values(groups).flat();
  // Read BEFORE the patch: these rows are the only place each mission's
  // conversation key survives (`cached-conversation-rows.ts`).
  const rows = allCachedConversationRows(qc, paths);
  return optimisticWrite({
    qc,
    command: "bulk_delete_missions",
    patches: missionRemovalPatches(groups),
    write: perAgent(groups, tauriActivity.bulkDelete),
    invalidate: bulkRefresh(groups, paths),
    failure: {
      title: i18n.t("board:writeFailed.bulkDelete"),
      description: i18n.t("board:writeFailed.bulkBack"),
    },
    // Attached files stay in each workspace's uploads/ folder (HOU-706).
    onSuccess: () => forgetDeletedConversationDrafts(ids, rows),
  });
}

/** Move or archive a cross-agent selection. */
export function editMissions(
  qc: QueryClient,
  groups: MissionGroups,
  paths: string[],
  status: string,
  kind: "move" | "archive",
): Promise<void> {
  if (Object.keys(groups).length === 0) return Promise.resolve();
  return optimisticWrite({
    qc,
    command:
      kind === "archive" ? "bulk_archive_missions" : "bulk_move_missions",
    patches: missionEditPatches(groups, { status }, new Date().toISOString()),
    write: perAgent(groups, (agentPath, ids) =>
      tauriActivity.bulkUpdate(agentPath, ids, { status }),
    ),
    invalidate: bulkRefresh(groups, paths),
    failure: {
      title: i18n.t(
        kind === "archive"
          ? "board:writeFailed.bulkArchive"
          : "board:writeFailed.bulkMove",
      ),
      description: i18n.t("board:writeFailed.bulkBack"),
    },
  });
}
