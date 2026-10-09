/**
 * The compact "this one will fail" chip a routine row carries (PRODUCT-1475).
 *
 * A routine list is where a person notices a broken automation, so the warning
 * has to live on the ROW, not only inside the routine's screen. It renders only
 * for a routine whose resolved provider is confirmed unusable AND whose creator
 * is the viewer — the viewer's `/providers` answer says nothing about anyone
 * else's account (see `useRoutineProviderHealth`). Healthy and still-checking
 * rows render nothing: a list of chips saying "fine" is noise. A routine the
 * engine auto-paused shows a "Paused" chip instead, and one it is holding for
 * a plan usage limit shows "Paused until <time>"; the screen says why.
 *
 * A component rather than a plain function because it resolves the pair and
 * probes the provider through hooks; the grid's slot takes the rendered node.
 */

import type { Routine } from "@houston/engine-adapter";
import {
  formatLocalDateTime,
  routinePauseNotice,
  routineSnoozeNotice,
} from "@houston/sdk";
import { useTranslation } from "react-i18next";
import { useRoutineModelResolution } from "../../hooks/use-routine-model-resolution";
import { useRoutineProviderHealth } from "../../hooks/use-routine-provider-health";
import { routineHealthBlocksRun } from "../../lib/routine-provider-health";
import type { Agent } from "../../lib/types";
import { RoutineProviderHealthBadge } from "./routine-provider-health-badge";

export function RoutineWarningChip({
  agent,
  routine,
}: {
  /** The routine's OWNING agent — a cross-agent list has one per row. */
  agent: Agent;
  routine: Routine;
}) {
  const { t, i18n } = useTranslation("routines");
  const { provider } = useRoutineModelResolution(agent, routine);
  const { showBadge, health } = useRoutineProviderHealth(
    routine.created_by,
    provider,
  );
  // The engine paused it after repeated failures, or is holding it until a
  // plan limit resets: either outranks a live health probe, since the routine
  // will not run until someone resumes it or the hold ends.
  const held = routineSnoozeNotice(routine);
  if (routinePauseNotice(routine) || held)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-warning"
        />
        {held
          ? t("details.snooze.chip", {
              time: formatLocalDateTime(held.until, i18n.language),
            })
          : t("details.autoPause.chip")}
      </span>
    );
  if (!showBadge || !routineHealthBlocksRun(health)) return null;
  return (
    <RoutineProviderHealthBadge health={health} provider={provider} compact />
  );
}
