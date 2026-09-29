import {
  addressesMission,
  normalizeActivities,
  parseJsonDoc,
} from "@houston/domain";
import type { Activity } from "@houston/protocol";
import type { MissionTitleMiss } from "../session/mission-title";
import type { TurnSyncReport } from "./turn-sync-report";

/**
 * What became of a new mission's after-turn title, as the per-turn terminal
 * frame reports it (worker stdout is invisible in a per-turn sandbox, so the
 * frame is the only telemetry). `written` means the LANDED board's card
 * carries the title; `sync_lost` means it was written in the tree but never
 * landed.
 */
export type MissionTitleOutcome =
  /** The landed card carries the title. */
  | "written"
  /** The card no longer showed its fallback: a rename won. */
  | "renamed"
  /** No card for the mission in the hydrated, stored or landed board. */
  | "card_missing"
  /** The card write itself threw. */
  | "write_failed"
  /** The turn failed or was cancelled, so no title was attempted. */
  | "skipped"
  /** Titled in the tree, but the title never landed with the board. */
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

/** The card write a `written` report stands for. */
export interface MissionTitleWrite {
  conversationId: string;
  title: string;
  fallback: string;
}

/** The in-session report. `written` is checked against the landed board and
 *  never rides the frame: a title is the user's words, not telemetry. */
export interface InTreeMissionTitle extends MissionTitleReport {
  written?: MissionTitleWrite;
}

/**
 * The in-session report settled against what sync-back landed. No sync
 * report means no pass completed (fenced, or the sync threw), so nothing did.
 * A landed board is read back: a merge may have kept a concurrent rename or
 * delete over the title.
 */
export function landedMissionTitle(
  inTree: InTreeMissionTitle | undefined,
  sync: TurnSyncReport | undefined,
): MissionTitleReport {
  const { written, ...report } = inTree ?? { outcome: "skipped", ms: 0 };
  if (report.outcome !== "written") return report;
  const board = sync?.board ?? { landed: false };
  return {
    ...report,
    outcome: board.landed ? landedOutcome(written, board.body) : "sync_lost",
    ...(board.mergeAttempts ? { mergeAttempts: board.mergeAttempts } : {}),
  };
}

/** What the landed card says. Bytes the pass could not verify (none, or
 *  unreadable) leave the landing as the only evidence. */
function landedOutcome(
  written: MissionTitleWrite | undefined,
  body: string | undefined,
): MissionTitleOutcome {
  if (!written || body === undefined) return "written";
  const cards = landedCards(body);
  if (!cards) return "written";
  const card = cards.find((a) => addressesMission(a, written.conversationId));
  if (!card) return "card_missing";
  if (card.title === written.title) return "written";
  return card.title === written.fallback ? "sync_lost" : "renamed";
}

const BOARD = "activity.json";

function landedCards(body: string): Activity[] | undefined {
  try {
    return normalizeActivities(parseJsonDoc(body, BOARD), BOARD).items;
  } catch (err) {
    // Only this worker's own JSON lands here; a throw must not cost the turn
    // its terminal frame.
    console.error(
      "[mission-title] landed board unreadable; trusting the landing:",
      err instanceof Error ? err.message : String(err),
    );
    return undefined;
  }
}
