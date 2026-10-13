import { HeartbeatRunStatus } from "@houston/protocol";
import { type HeartbeatDoc, updateHeartbeatDoc } from "./heartbeat";
import type { TextStore } from "./store";

/**
 * A briefing turn's two moments. Admission (the runtime accepted the turn)
 * claims the day and shows `delivered`; only the turn FINISHING with a reply
 * updates `seen` (heartbeat-news.ts rule 5). A turn that ends any other way
 * leaves `seen` alone, so the same items are told on the next briefing.
 */

/** The runtime accepted the briefing turn: the day is claimed, the turn pends. */
export async function recordHeartbeatAdmitted(
  store: TextStore,
  workspaceId: string,
  run: { date: string; at: string; nonce: string; seen: string[] },
): Promise<void> {
  await updateHeartbeatDoc(store, workspaceId, (current) => ({
    ...current,
    last: {
      status: HeartbeatRunStatus.Delivered,
      date: run.date,
      at: run.at,
    },
    pending: { nonce: run.nonce, at: run.at, seen: run.seen },
  }));
}

/** How the pending turn ended, as the host read it off its turn record.
 *  `nonce` names WHICH turn: the one the host read. */
export type HeartbeatTurnEnd =
  | { kind: "completed"; nonce: string; at: string }
  | { kind: "failed"; nonce: string; at: string; reason: string };

/**
 * Settle the pending turn. Completed: `seen` becomes what the briefing
 * covered. Failed: the run reads as an error and `seen` stays. Null when the
 * turn read is no longer the pending one (another settle got there first, or
 * a newer briefing replaced it in between), so an outcome never lands on the
 * wrong briefing and one briefing is never announced twice.
 */
export function settleHeartbeatRun(
  store: TextStore,
  workspaceId: string,
  end: HeartbeatTurnEnd,
): Promise<HeartbeatDoc | null> {
  return updateHeartbeatDoc(store, workspaceId, (current) => {
    const { pending, last } = current;
    if (pending?.nonce !== end.nonce) return null;
    if (end.kind === "completed")
      return { ...current, pending: null, seen: pending.seen };
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
