import { HeartbeatRunStatus } from "@houston/protocol";
import { type HeartbeatDoc, updateHeartbeatDoc } from "./heartbeat";
import type { TextStore } from "./store";

/**
 * A briefing turn's two moments. Admission (the runtime accepted the turn)
 * claims the day and shows `delivered`; only the turn FINISHING with a reply
 * moves the news baseline. A turn that dies after admission (provider error,
 * runtime death) leaves the baseline where it was, so the same items are told
 * on the next briefing instead of being taken as already heard.
 */

const isoOrNull = (ms: number | null) =>
  ms === null ? null : new Date(ms).toISOString();

const laterOf = (a: string | null, b: string | null) => {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
};

/** The runtime accepted the briefing turn: the day is claimed, the turn pends. */
export async function recordHeartbeatAdmitted(
  store: TextStore,
  workspaceId: string,
  run: { date: string; at: string; coveredThroughMs: number | null },
): Promise<void> {
  await updateHeartbeatDoc(store, workspaceId, (current) => ({
    ...current,
    last: {
      status: HeartbeatRunStatus.Delivered,
      date: run.date,
      at: run.at,
    },
    pending: { at: run.at, coveredThrough: isoOrNull(run.coveredThroughMs) },
  }));
}

/** How the pending turn ended, as the host read it off the transcript. */
export type HeartbeatTurnEnd =
  | { kind: "completed"; at: string }
  | { kind: "failed"; at: string; reason: string };

/**
 * Settle the pending turn. Completed: the baseline moves to what it covered.
 * Failed: the run reads as an error and the baseline stays. Null when nothing
 * was pending any more (another settle got there first), so the caller never
 * announces one briefing twice.
 */
export function settleHeartbeatRun(
  store: TextStore,
  workspaceId: string,
  end: HeartbeatTurnEnd,
): Promise<HeartbeatDoc | null> {
  return updateHeartbeatDoc(store, workspaceId, (current) => {
    const { pending, last } = current;
    if (!pending) return null;
    if (end.kind === "completed")
      return {
        ...current,
        pending: null,
        briefedAt: end.at,
        briefedThrough: laterOf(current.briefedThrough, pending.coveredThrough),
      };
    return {
      ...current,
      pending: null,
      last: {
        status: HeartbeatRunStatus.Error,
        date: last?.date ?? end.at.slice(0, 10),
        at: end.at,
        reason: end.reason,
      },
    };
  });
}
