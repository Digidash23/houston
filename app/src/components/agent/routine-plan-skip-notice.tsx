/**
 * RoutinePlanSkipNotice — tells a person that a Free plan refused some of a
 * trigger routine's runs, which never reach the history and would otherwise
 * leave the routine looking broken. Mounted on the routine screen and at the
 * top of its runs dialog, where people look for the missing run.
 *
 * The gateway judged those runs on the routine CREATOR's plan, so this feeds
 * the SDK the creator, the signed-in viewer and the routine's gateway key
 * (`triggerPlanSkipNotice`); a teammate gets the read-only variant.
 *
 * It reads the SAME per-agent trigger-status cache entry as the activation
 * chip (`agentTriggerStatusQueryOptions`), without the chip's error toast so a
 * failed read is reported once. Mounting it (opening the dialog) refetches a
 * stale entry and window focus refetches it, so no polling of its own.
 */

import type { Routine } from "@houston/engine-adapter";
import { triggerPlanSkipNotice } from "@houston/sdk";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePlan, useResumeRoutines } from "../../hooks/queries/use-plan";
import { agentTriggerStatusQueryOptions } from "../../hooks/queries/use-triggers";
import { useSession } from "../../hooks/use-session";
import { orgSlugFromWorkspaceId } from "../../lib/space-id";
import { useUIStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspaces";
import { RoutinePlanSkipNoticeControls } from "./routine-plan-skip-notice-controls";

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
  const { data: session } = useSession();
  const workspace = useWorkspaceStore((s) => s.current);
  const openSettings = useUIStore((s) => s.openSettings);
  const openKeepChooser = useUIStore((s) => s.setPlanKeepDialogOpen);
  const resume = useResumeRoutines();

  const notice = triggerPlanSkipNotice(
    status.data?.find((item) => item.routine_id === routine.id),
    plan,
    {
      createdBy: routine.created_by,
      viewerId: session?.uid,
      // A hosted agent's client-side id IS its gateway slug.
      agentSlug: agentId,
      // Known for a team space; the personal space's slug is opaque here.
      orgSlug: workspace ? orgSlugFromWorkspaceId(workspace.id) : null,
    },
  );
  if (!notice) return null;

  return (
    <RoutinePlanSkipNoticeControls
      notice={notice}
      effects={{
        openBilling: () => openSettings("plan"),
        openKeepChooser: () => openKeepChooser(true),
        // A failure is surfaced by the engine call itself (`tauriOrg`).
        resume: () => resume.mutate(),
        resuming: resume.isPending,
      }}
      onLeave={onLeave}
      layout={layout}
      className={className}
    />
  );
}
