import type { SyncMerge } from "@houston/runtime-client/object-sync";
import { turnActivityKey } from "./turn-filesystem-scope";

/** What a turn's sync-back could not land, for the terminal frame. */
export interface TurnSyncReport {
  /** Keys left un-landed: generation conflicts that outlived every merge
   *  round, and files over the store's per-object cap. */
  incomplete?: { conflicts: string[]; skipped: string[] };
  /** Merged documents that lost a first race, with the rounds each took and
   *  the board card ids a landed merge removed (a drop is visible here). */
  merges?: SyncMerge[];
  /** The agent's board (`activity.json`): landed this pass or not. */
  board: { landed: boolean; mergeAttempts?: number };
}

/** Summarize one sync-back pass, singling out the agent's board. */
export function turnSyncReport(
  synced: {
    uploaded: readonly string[];
    conflicts: readonly { key: string }[];
    skipped: readonly { key: string }[];
    merges: readonly SyncMerge[];
  },
  workspaceRel: string,
): TurnSyncReport {
  const boardKey = turnActivityKey(workspaceRel);
  const incomplete =
    synced.conflicts.length > 0 || synced.skipped.length > 0
      ? {
          conflicts: synced.conflicts.map(({ key }) => key),
          skipped: synced.skipped.map(({ key }) => key),
        }
      : undefined;
  const boardMerge = synced.merges.find(({ key }) => key === boardKey);
  return {
    ...(incomplete ? { incomplete } : {}),
    ...(synced.merges.length > 0 ? { merges: [...synced.merges] } : {}),
    board: {
      landed: synced.uploaded.includes(boardKey),
      ...(boardMerge ? { mergeAttempts: boardMerge.attempts } : {}),
    },
  };
}
