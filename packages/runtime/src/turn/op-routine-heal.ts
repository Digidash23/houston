import { docKey } from "@houston/domain";
import { isRoutineNotFoundBody } from "@houston/protocol/routine-refusal";
import { familyDoc } from "./op-family-doc";
import { type DocDeps, docTarget, type OpClaimTurn } from "./op-republish";
import type { OpResult } from "./op-result";
import type { AgentOp } from "./parse-op-request";
import type { ActivityDocSource } from "./turn-activity-source";
import { publishDerived } from "./turn-doc-merge-publish";
import { readStoreText } from "./turn-store-read";
import { docNotLandedReason } from "./turn-view-publish";

/**
 * The whole heal's wall-clock budget. The gateway's run-now waits 5 s for a
 * routine turn's typed failure (`runNowEarlyWindow`, which already spends
 * dispatch and hydrate); a heal that outlasts it turns the 404 into a 200 for
 * a run that never started. So the heal gets one try per request, no retries,
 * and gives up whole once this is spent.
 */
export const ROUTINE_HEAL_BUDGET_MS = 1_500;

const ROUTINE_ITEM = /^routines\/([^/]+)$/;

/**
 * The routine id a write named when it answered that the routine does not
 * exist, or null for any other answer. The caller picked the routine from the
 * gateway's asleep mirror of the routines doc, so that mirror still lists a
 * routine the store no longer holds (a delete whose worker died before it
 * re-projected). Run-now never reaches a worker as an op
 * (`op-route-allowlist.ts`): it is a routine turn, healed by
 * `turn-routine-start.ts` on its `no_routine` failure.
 */
export function staleRoutineWriteId(
  op: AgentOp,
  result: OpResult,
): string | null {
  if (op.kind !== "route" || result.status !== 404) return null;
  if (op.method !== "PATCH" && op.method !== "DELETE") return null;
  let rest: string;
  try {
    rest = decodeURIComponent(op.rest);
  } catch {
    return null;
  }
  const id = ROUTINE_ITEM.exec(rest)?.[1];
  if (!id) return null;
  try {
    return isRoutineNotFoundBody(JSON.parse(result.body)) ? id : null;
  } catch {
    // Not JSON: not the host's refusal, so no stale mirror to blame.
    return null;
  }
}

/** The mirror no longer lists the routine: nothing to heal, nothing to say. */
class MirrorAlreadyRight extends Error {}

const listsRoutine = (doc: unknown, id: string) =>
  Array.isArray(doc) &&
  doc.some((r) => (r as { id?: unknown } | null)?.id === id);

/**
 * Re-project the routines doc from what the store holds, so the ghost
 * `routineId` (named by a stale write or run-now) leaves every member's list.
 * Shared by the op path and the routine turn path. Answers `RoutinesChanged`
 * only once the doc landed; nothing when the mirror already omits the routine
 * (a scheduled fire of a deleted routine must not re-PUT and fan out every
 * tick) or when the heal failed or ran out of budget. The caller wrote
 * nothing, so there is nothing to sync back.
 *
 * A heal that fails leaves the ghost until the next projection: the SDK's
 * idempotent delete still reports success, so the row can come back on the
 * next list read. The failure is logged as an error here, its only trace.
 */
export async function healRoutinesMirror(
  deps: DocDeps,
  turn: OpClaimTurn,
  source: ActivityDocSource,
  workspaceRel: string,
  routineId: string,
): Promise<"RoutinesChanged"[]> {
  const common = docTarget(deps, turn);
  if (!common) return [];
  const budget = new AbortController();
  const fetchImpl = common.fetchImpl;
  const key = docKey(workspaceRel, "routines");
  const heal = publishDerived(
    {
      ...common,
      family: "routines",
      retryDelaysMs: [],
      // Every doc request dies with the budget, so no PUT lands after it.
      fetchImpl: ((input, init) =>
        fetchImpl(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, budget.signal])
            : budget.signal,
        })) as typeof fetch,
    },
    async (current) => {
      if (!listsRoutine(current, routineId)) throw new MirrorAlreadyRight();
      if (budget.signal.aborted) throw new Error("heal budget spent");
      const doc = familyDoc("routines", await readStoreText(source, key), key);
      if (budget.signal.aborted) throw new Error("heal budget spent");
      if (doc === undefined) throw new Error("file is not JSON, not projected");
      return doc;
    },
  ).then(docNotLandedReason, (error: unknown) =>
    error instanceof MirrorAlreadyRight
      ? "already right"
      : error instanceof Error
        ? error.message
        : String(error),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      budget.abort();
      resolve(`no answer within ${ROUTINE_HEAL_BUDGET_MS} ms`);
    }, ROUTINE_HEAL_BUDGET_MS);
  });
  const failure = await Promise.race([heal, expired]);
  clearTimeout(timer);
  budget.abort();
  if (failure === "already right") return [];
  const at = `routine=${routineId} prefix=${turn.gcsPrefix}`;
  if (failure) {
    console.error(
      `[routines] stale routines mirror not healed: ${failure} ${at}`,
    );
    return [];
  }
  console.warn(`[routines] re-projected the routines doc over a ghost ${at}`);
  return ["RoutinesChanged"];
}
