/**
 * The look of the "your plan skipped this routine's events" notice: why
 * (the SDK's `triggerPlanSkipNotice` decides the reason and the actions) and
 * one button per action. Props only, so the routine screen and the runs
 * dialog draw the same thing and a test can render it without a query.
 */

import type {
  TriggerPlanSkipAction,
  TriggerPlanSkipNotice,
} from "@houston/sdk";
import { Button, cn } from "@houston-ai/core";
import { useTranslation } from "react-i18next";

interface Props {
  notice: TriggerPlanSkipNotice;
  onAction: (action: TriggerPlanSkipAction) => void;
  /** The action in flight (Resume), disabled until it settles. */
  pending?: TriggerPlanSkipAction | null;
  /** `row` puts the actions beside the text from the desktop edge up (the
   *  routine screen); `stacked` keeps them under it at every width (the
   *  narrow runs dialog). */
  layout?: "row" | "stacked";
  /** Width and spacing from the mount. */
  className?: string;
}

export function RoutinePlanSkipNoticeView({
  notice,
  onAction,
  pending = null,
  layout = "row",
  className,
}: Props) {
  const { t } = useTranslation("plan");

  // Spelled out per reason rather than built from it: `t()` keys are typed,
  // so a template-literal key would compile past a typo.
  const body = (): string => {
    switch (notice.reason) {
      case "min_interval":
        return t("triggerSkipped.minInterval");
      case "routine_limit":
        return t("triggerSkipped.routineLimit");
      case "routine_limit_paused":
        return t("triggerSkipped.routineLimitPaused");
      case "inactive_paused":
        return t("triggerSkipped.inactivePaused");
      case "inactive_resumed":
        return t("triggerSkipped.inactiveResumed");
      case "creator_plan":
        return t("triggerSkipped.creatorPlan");
    }
  };
  const label = (action: TriggerPlanSkipAction): string => {
    switch (action) {
      case "upgrade":
        return t("upgrade");
      case "keep_routine":
        return t("chooseRoutine");
      case "resume":
        return t("resume");
    }
  };

  return (
    <div
      role="status"
      data-testid="routine-plan-skip-notice"
      data-reason={notice.reason}
      className={cn(
        "flex w-full flex-col gap-3 rounded-lg border border-line bg-card px-4 py-3",
        layout === "row" && "md:flex-row md:items-center md:gap-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-start gap-1.5 text-sm font-medium text-ink">
          {/* h-5 = text-sm's line height: the dot centres on the first line
              when the title wraps. */}
          <span aria-hidden className="flex h-5 shrink-0 items-center">
            <span className="size-1.5 rounded-full bg-warning" />
          </span>
          {t("triggerSkipped.title", { count: notice.count })}
        </p>
        <p className="text-sm text-ink-muted">{body()}</p>
      </div>
      {notice.actions.length > 0 && (
        <div
          className={cn(
            "flex flex-wrap gap-2 self-start",
            layout === "row" && "md:shrink-0 md:self-center",
          )}
        >
          {notice.actions.map((action) => (
            <Button
              key={action}
              variant="secondary"
              size="sm"
              disabled={pending === action}
              onClick={() => onAction(action)}
            >
              {label(action)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
