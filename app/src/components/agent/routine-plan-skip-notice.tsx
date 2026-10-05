/**
 * RoutinePlanSkipNotice — tells a Free person that their plan refused some of
 * a trigger routine's events, which never become runs and would otherwise
 * leave the routine looking broken. Mounted on the routine screen and at the
 * top of its runs dialog, where people look for the missing run.
 *
 * It reads the SAME per-agent trigger-status cache entry as the activation
 * chip (`agentTriggerStatusQueryOptions`), without the chip's error toast so a
 * failed read is reported once. Mounting it (opening the dialog) refetches a
 * stale entry and window focus refetches it, so no polling of its own.
 */

import type { Routine } from "@houston/engine-adapter";
import {
  type TriggerPlanSkipAction,
  triggerPlanSkipNotice,
} from "@houston/sdk";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePlan, useResumeRoutines } from "../../hooks/queries/use-plan";
import { agentTriggerStatusQueryOptions } from "../../hooks/queries/use-triggers";
import { useUIStore } from "../../stores/ui";
import { RoutinePlanSkipNoticeView } from "./routine-plan-skip-notice-view";

interface Props {
  agentId: string;
  routine: Routine;
  /** Runs before an action that navigates away or opens another dialog, so a
   *  hosting dialog can close first. */
  onLeave?: () => void;
  layout?: "row" | "stacked";
  className?: string;
}

export function RoutinePlanSkipNotice({
  agentId,
  routine,
  onLeave,
  layout,
  className,
}: Props) {
  const routineIds = useMemo(() => [routine.id], [routine.id]);
  const status = useQuery({
    ...agentTriggerStatusQueryOptions(agentId, routineIds),
    enabled: !!routine.trigger,
  });
  const { data: plan } = usePlan();
  const openSettings = useUIStore((s) => s.openSettings);
  const openKeepChooser = useUIStore((s) => s.setPlanKeepDialogOpen);
  const resume = useResumeRoutines();

  const notice = triggerPlanSkipNotice(
    status.data?.find((item) => item.routine_id === routine.id),
    plan,
  );
  if (!notice) return null;

  const onAction = (action: TriggerPlanSkipAction) => {
    switch (action) {
      case "upgrade":
        onLeave?.();
        openSettings("plan");
        return;
      case "keep_routine":
        onLeave?.();
        openKeepChooser(true);
        return;
      case "resume":
        // A failure is surfaced by the engine call itself (`tauriOrg`).
        resume.mutate();
        return;
    }
  };

  return (
    <RoutinePlanSkipNoticeView
      notice={notice}
      onAction={onAction}
      pending={resume.isPending ? "resume" : null}
      layout={layout}
      className={className}
    />
  );
}
