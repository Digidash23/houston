/**
 * The plan-skip notice's actions wired to what they do, with the effects
 * passed in: `RoutinePlanSkipNotice` hands over the store and the resume
 * mutation, a test hands over fakes. An action that leaves (Billing, the keep
 * chooser) runs `onLeave` FIRST, so a hosting dialog closes before another
 * screen or dialog opens over it.
 */

import type {
  TriggerPlanSkipAction,
  TriggerPlanSkipNotice,
} from "@houston/sdk";
import { RoutinePlanSkipNoticeView } from "./routine-plan-skip-notice-view";

export interface PlanSkipEffects {
  openBilling: () => void;
  openKeepChooser: () => void;
  resume: () => void;
  /** Resume is in flight; its button stays disabled until it settles. */
  resuming: boolean;
}

interface Props {
  notice: TriggerPlanSkipNotice;
  effects: PlanSkipEffects;
  onLeave?: () => void;
  layout?: "row" | "stacked";
  surface?: "card" | "inline";
  className?: string;
}

export function RoutinePlanSkipNoticeControls({
  notice,
  effects,
  onLeave,
  layout,
  surface,
  className,
}: Props) {
  const onAction = (action: TriggerPlanSkipAction) => {
    switch (action) {
      case "upgrade":
        onLeave?.();
        effects.openBilling();
        return;
      case "keep_routine":
        onLeave?.();
        effects.openKeepChooser();
        return;
      case "resume":
        effects.resume();
        return;
    }
  };

  return (
    <RoutinePlanSkipNoticeView
      notice={notice}
      onAction={onAction}
      pending={effects.resuming ? "resume" : null}
      layout={layout}
      surface={surface}
      className={className}
    />
  );
}
