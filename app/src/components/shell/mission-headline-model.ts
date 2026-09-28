import { ARCHIVED_STATUS } from "../../lib/mission-selection.ts";

/** The state an agent row's second line reports, in the board's own words. */
export type HeadlineStatus = "needs_you" | "running" | "done" | "idle";

/** The mission an agent row names under the agent. */
export interface MissionHeadline {
  /** Empty only for a RUNNING mission not yet named: being at work is worth
   *  saying even before the task has a title. */
  title: string;
  /** ISO 8601 instant of its last movement: the row's time. */
  updatedAt: string;
  status: HeadlineStatus;
}

/** One task row, the headline-relevant bits. */
export interface HeadlineRow {
  status?: string | null;
  title?: string;
  updated_at?: string;
}

/** Collects one agent's rows and names the one its sidebar row leads with. */
export interface HeadlineTracker {
  note(row: HeadlineRow): void;
  headline(): MissionHeadline | null;
}

function statusOf(raw: string | null | undefined): HeadlineStatus {
  if (raw === "needs_you" || raw === "running" || raw === "done") return raw;
  return "idle";
}

function later(
  current: MissionHeadline | null,
  next: MissionHeadline,
): MissionHeadline {
  if (!current) return next;
  // Parsed, not compared as strings: hosts stamp with and without millis.
  return Date.parse(current.updatedAt) >= Date.parse(next.updatedAt)
    ? current
    : next;
}

/**
 * The row leads with what is happening NOW, the way a chat shows "typing…" over
 * the last message: the newest mission at work, else the newest one waiting on
 * the person, else the newest of any kind. Work in progress wins over a wait
 * because the wait keeps its own signal, the count at the row's end, while
 * work has no other way onto an expanded row.
 *
 * Archived and undated rows never lead, nor untitled ones unless they are at
 * work: a line saying what an archived task was says something that stopped
 * being true.
 */
export function createHeadlineTracker(): HeadlineTracker {
  const newest: Partial<
    Record<"needs_you" | "running" | "any", MissionHeadline>
  > = {};
  return {
    note(row) {
      if (row.status === ARCHIVED_STATUS) return;
      const title = row.title?.trim() ?? "";
      if (!row.updated_at) return;
      if (!title && row.status !== "running") return;
      if (Number.isNaN(Date.parse(row.updated_at))) return;
      const candidate: MissionHeadline = {
        title,
        updatedAt: row.updated_at,
        status: statusOf(row.status),
      };
      newest.any = later(newest.any ?? null, candidate);
      if (candidate.status === "needs_you" || candidate.status === "running") {
        const kind = candidate.status;
        newest[kind] = later(newest[kind] ?? null, candidate);
      }
    },
    headline() {
      return newest.running ?? newest.needs_you ?? newest.any ?? null;
    },
  };
}
