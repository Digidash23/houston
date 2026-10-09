import type {
  NewRoutine,
  Routine,
  RoutineUpdate,
} from "@houston/engine-adapter";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { genericErrorDescription } from "../../lib/error-report";
import { holdPatchesAcrossRefetch } from "../../lib/optimistic-hold";
import type { OptimisticPatch } from "../../lib/optimistic-write";
import { queryKeys } from "../../lib/query-keys";
import {
  patchRoutineList,
  replaceRoutineInList,
} from "../../lib/routine-optimistic";
import { toastRoutineWriteFailure } from "../../lib/routine-write-failure";
import { tauriRoutines } from "../../lib/tauri";
import { useUIStore } from "../../stores/ui";
import {
  type RoutineWriteFor,
  useRoutineRowWrites,
} from "./use-routine-row-writes";

export type { RoutineWriteFor };

/** Which edit a refused update undoes: it picks the refusal toast's title. */
export type RoutineUpdateKind = "save" | "model";

const UPDATE_FAILURE = {
  save: { titleKey: "toasts.updateError", command: "update_routine" },
  model: { titleKey: "toasts.modelError", command: "set_routine_model" },
} as const;

/**
 * ONE agent's routines query, as options. Both the open routine's chat
 * (`useRoutines`) and the employee's Routines list build from this, so they
 * share the key, the cache entry and the queryFn: the routines event
 * invalidation (`use-agent-invalidation.ts` → `queryKeys.routines(path)`)
 * refreshes both, and neither can serve a different truth than the other.
 */
export function routinesQueryOptions(agentPath: string) {
  return {
    queryKey: queryKeys.routines(agentPath),
    queryFn: () => tauriRoutines.list(agentPath),
    staleTime: 30_000,
  };
}

/** One agent's routine RUNS, as options — the sibling of
 *  {@link routinesQueryOptions} for the same reason. */
export function routineRunsQueryOptions(agentPath: string) {
  return {
    queryKey: queryKeys.routineRuns(agentPath),
    queryFn: () => tauriRoutines.listRuns(agentPath),
    staleTime: 30_000,
  };
}

export function useRoutines(agentPath: string | undefined) {
  return useQuery({
    ...routinesQueryOptions(agentPath ?? ""),
    enabled: !!agentPath,
  });
}

/**
 * What a routine WRITE leaves behind: that agent's routines list refetched.
 * The host reschedules on the write itself. Shared by `useCreateRoutine` and
 * the any-agent update so the two can never drift apart on what a write
 * invalidates.
 */
function afterRoutineWrite(qc: QueryClient, agentPath: string): void {
  qc.invalidateQueries({ queryKey: queryKeys.routines(agentPath) });
}

export function useCreateRoutine(agentPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewRoutine) => tauriRoutines.create(agentPath, input),
    onSuccess: () => afterRoutineWrite(qc, agentPath),
  });
}

/**
 * The routine writes a routine ROW can trigger (edit, delete, run now, stop a
 * run), with the AGENT in the variables instead of in the hook argument, so
 * one binding serves whichever agent a call names (the routine screen, its
 * model selector and the Routines list). Every one paints before the host
 * answers; delete and the run controls live in `use-routine-row-writes.ts`.
 */
export function useRoutineWritesForAnyAgent() {
  const qc = useQueryClient();
  const { t } = useTranslation("routines");
  // Optimistic (PRODUCT-1706): the row and the screen paint the edit the
  // instant it is sent. On the hosted profile a write can take seconds (the
  // agent's pod may have to wake first), and painting the OLD schedule for
  // that window made a saved time look ignored. The host's applied routine
  // replaces the guess when it lands; a rejected write rolls the cache back
  // and refetches. Kept on `useMutation` (not `optimisticWrite`) because the
  // plan floor's refusal must stand down too (`toastRoutineWriteFailure`); the
  // hold below is the same one `optimisticWrite` uses.
  // The refusal toast lives HERE, never in a per-call `mutate(vars, { onError })`:
  // TanStack fires per-call callbacks only for the observer's latest mutate
  // while it is mounted, so a second edit (or leaving the screen) before the
  // first one's refusal would roll it back in silence.
  const update = useMutation({
    mutationFn: ({
      agentPath,
      routineId,
      updates,
    }: RoutineWriteFor & {
      updates: RoutineUpdate;
      kind?: RoutineUpdateKind;
    }) => tauriRoutines.update(agentPath, routineId, updates),
    onMutate: ({ agentPath, routineId, updates }) => {
      const queryKey = queryKeys.routines(agentPath);
      // An in-flight refetch would overwrite the optimistic row with the
      // pre-edit truth the moment it lands.
      void qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<Routine[]>(queryKey);
      const nowIso = new Date().toISOString();
      const patch: OptimisticPatch<Routine[]> = {
        queryKey,
        apply: (list) => patchRoutineList(list, routineId, updates, nowIso),
      };
      qc.setQueryData<Routine[]>(queryKey, patch.apply);
      return { previous, release: holdPatchesAcrossRefetch(qc, [patch]) };
    },
    onError: (err, { agentPath, kind }, context) => {
      context?.release();
      const key = queryKeys.routines(agentPath);
      if (context?.previous) qc.setQueryData(key, context.previous);
      qc.invalidateQueries({ queryKey: key });
      const failure = UPDATE_FAILURE[kind ?? "save"];
      toastRoutineWriteFailure(
        err,
        { title: t(failure.titleKey), command: failure.command },
        {
          addToast: useUIStore.getState().addToast,
          describe: genericErrorDescription,
        },
      );
    },
    onSuccess: (routine, { agentPath }, context) => {
      context?.release();
      qc.setQueryData<Routine[]>(queryKeys.routines(agentPath), (list) =>
        replaceRoutineInList(list, routine),
      );
      afterRoutineWrite(qc, agentPath);
    },
  });
  return { update, ...useRoutineRowWrites() };
}
