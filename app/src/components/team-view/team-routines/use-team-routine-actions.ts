import type { RoutineUpdate } from "@houston/engine-adapter";
import { useTranslation } from "react-i18next";
import {
  useRoutineWritesForAnyAgent,
  useUpdateActivityForAnyAgent,
} from "../../../hooks/queries";
import { useRoutineScheduleFloor } from "../../../hooks/use-routine-schedule-floor";
import { analytics } from "../../../lib/analytics";
import { genericErrorDescription } from "../../../lib/error-report";
import type { Agent } from "../../../lib/types";
import { useUIStore } from "../../../stores/ui";

/** Every row action the grid fires, keyed by routine or draft activity id. */
export interface TeamRoutineActions {
  onToggle: (routineId: string, enabled: boolean) => void;
  onScheduleChange: (routineId: string, cron: string) => void;
  onDeleteRoutine: (routineId: string) => void;
  onRunNow: (routineId: string) => void;
  onStopRun: (routineId: string, runId: string) => void;
  onDiscardDraft: (activityId: string) => void;
}

/**
 * The employee's row actions, every one painted before the host answers. A
 * refused edit, delete or run control rolls back with the toast its hook
 * carries (`useRoutineWritesForAnyAgent`). Discarding a draft is
 * the one awaited write: the activity update throws its own "Activity not
 * found" without going through `call()`, so that one is toasted here.
 */
export function useTeamRoutineActions(agent: Agent): TeamRoutineActions {
  const { t } = useTranslation("routines");
  const { t: planT } = useTranslation("plan");
  const floor = useRoutineScheduleFloor();
  const addToast = useUIStore((s) => s.addToast);
  const { update, remove, runNow, cancelRun } = useRoutineWritesForAnyAgent();
  const updateActivity = useUpdateActivityForAnyAgent();
  const agentPath = agent.folderPath;
  const save = (routineId: string, updates: RoutineUpdate) =>
    update.mutate({ agentPath, routineId, updates });

  return {
    onToggle: (routineId, enabled) => save(routineId, { enabled }),
    // Inline cron edit from the row: the same update route every other routine
    // write uses (`schedule` clears any trigger binding server-side).
    onScheduleChange: (routineId, cron) => {
      // The same floor (and rule) the row editor got: the saver's own plan.
      if (floor && !floor.allows(cron)) {
        addToast({ title: planT("shortInterval", { minutes: floor.minutes }) });
        return;
      }
      save(routineId, { schedule: cron });
    },
    onDeleteRoutine: (routineId) => remove({ agentPath, routineId }),
    // Manual runs are the intentional analytics signal for usage.
    onRunNow: (routineId) => {
      analytics.track("routine_executed", { routine_id: routineId });
      runNow({ agentPath, routineId });
    },
    onStopRun: (routineId, runId) => cancelRun({ agentPath, routineId, runId }),
    onDiscardDraft: (activityId) => {
      void updateActivity
        .mutateAsync({ agentPath, activityId, update: { status: "archived" } })
        .catch((err: unknown) => {
          addToast({
            title: t("toasts.discardError"),
            description: genericErrorDescription("discard_draft", err),
            variant: "error",
          });
        });
    },
  };
}
