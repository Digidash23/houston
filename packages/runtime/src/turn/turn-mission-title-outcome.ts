import type { MissionTitleMiss } from "../session/mission-title";
import type { TurnSyncReport } from "./turn-sync-report";

/**
 * What became of a new mission's after-turn title, as the per-turn terminal
 * frame reports it (worker stdout is invisible in a per-turn sandbox, so the
 * frame is the only telemetry). `written` means the titled board LANDED in
 * the store; `sync_lost` means it was written in the tree but sync-back never
 * landed it.
 */
export type MissionTitleOutcome =
  /** The titled board is in the store. */
  | "written"
  /** The card no longer showed its fallback: a rename won. */
  | "renamed"
  /** No card for the mission in the hydrated or the stored board. */
  | "card_missing"
  /** The card write itself threw. */
  | "write_failed"
  /** The turn failed or was cancelled, so no title was attempted. */
  | "skipped"
  /** Titled in the tree, but the board upload never landed. */
  | "sync_lost"
  | MissionTitleMiss;

/** The terminal frame's `missionTitle` diagnostic. */
export interface MissionTitleReport {
  outcome: MissionTitleOutcome;
  /** Title call plus card write, from the reply's end. */
  ms: number;
  /** Merge rounds the board needed to land after a lost race. */
  mergeAttempts?: number;
}

/**
 * The in-session report settled against what sync-back landed. No sync
 * report means no pass completed (fenced, or the sync threw), so nothing did.
 */
export function landedMissionTitle(
  inTree: MissionTitleReport | undefined,
  sync: TurnSyncReport | undefined,
): MissionTitleReport {
  const report: MissionTitleReport = inTree ?? { outcome: "skipped", ms: 0 };
  if (report.outcome !== "written") return report;
  const board = sync?.board ?? { landed: false };
  return {
    ...report,
    ...(board.landed ? {} : { outcome: "sync_lost" }),
    ...(board.mergeAttempts ? { mergeAttempts: board.mergeAttempts } : {}),
  };
}
