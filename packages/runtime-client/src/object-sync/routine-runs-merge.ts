import { isDeepStrictEqual } from "node:util";
import { pruneRoutineRuns } from "@houston/protocol";

/** The run history; every overlapping routine run of an agent rewrites it. */
export const ROUTINE_RUNS_DOC = ".houston/routine_runs/routine_runs.json";

type Row = Record<string, unknown> & { id: string; routine_id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRow(value: unknown): value is Row {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.routine_id === "string"
  );
}

function instant(row: Row, field: "started_at" | "completed_at"): number {
  const value = row[field];
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

const isTerminal = (row: Row) =>
  typeof row.status === "string" && row.status !== "running";

/**
 * One run both sides hold. A run only moves forward (running, then one
 * terminal state), so the further copy wins: terminal over running, then a
 * cancel (the host never lets a finishing turn flip a stopped run back), then
 * the later `completed_at`. A tie goes to the remote.
 */
function pickRun(local: Row, remote: Row): Row {
  if (isTerminal(local) !== isTerminal(remote)) {
    return isTerminal(local) ? local : remote;
  }
  if (!isTerminal(local)) return remote;
  const localCancelled = local.status === "cancelled";
  if (localCancelled !== (remote.status === "cancelled")) {
    return localCancelled ? local : remote;
  }
  return instant(local, "completed_at") > instant(remote, "completed_at")
    ? local
    : remote;
}

function byId(items: readonly unknown[]): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const item of items) {
    if (!isRow(item)) continue;
    const seen = out.get(item.id);
    out.set(item.id, seen ? pickRun(item, seen) : item);
  }
  return out;
}

/**
 * Merge this writer's run history into a refreshed remote one by run `id`.
 * Two-way on purpose: nothing deletes a run but the per-routine cap, which is
 * re-applied here, so the union never resurrects a row a writer removed.
 * Rows come out newest `started_at` first (the order the cap assumes).
 * Entries that are not runs keep the remote's copies plus any local one the
 * remote does not already hold, after the runs.
 */
export function mergeRoutineRunArrays(
  remote: readonly unknown[],
  local: readonly unknown[],
): unknown[] {
  const remoteRuns = byId(remote);
  const localRuns = byId(local);
  const merged: Row[] = [];
  for (const [id, row] of remoteRuns) {
    const mine = localRuns.get(id);
    merged.push(mine ? pickRun(mine, row) : row);
  }
  for (const [id, row] of localRuns) {
    if (!remoteRuns.has(id)) merged.push(row);
  }
  // Stable: runs that started in the same instant keep the remote's order.
  merged.sort((a, b) => {
    const [x, y] = [instant(a, "started_at"), instant(b, "started_at")];
    return x === y ? 0 : x > y ? -1 : 1;
  });
  const remoteLoose = remote.filter((item) => !isRow(item));
  const localLoose = local.filter(
    (item) =>
      !isRow(item) &&
      !remoteLoose.some((kept) => isDeepStrictEqual(kept, item)),
  );
  return [...pruneRoutineRuns(merged), ...remoteLoose, ...localLoose];
}
