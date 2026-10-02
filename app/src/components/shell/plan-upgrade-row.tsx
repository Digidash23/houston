import { planUpgradeView } from "@houston/sdk";
import {
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@houston-ai/core";
import { sidebarCollapsedItem } from "@houston-ai/layout";
import { CircleAlert, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePlan } from "../../hooks/queries/use-plan";
import type { NavMode } from "../../lib/nav-stack";
import { useUIStore } from "../../stores/ui";

export function PlanUpgradeRow({
  collapsed = false,
  nav,
}: {
  collapsed?: boolean;
  nav?: NavMode;
}) {
  const { t } = useTranslation("plan");
  const { data: plan } = usePlan();
  const openSettings = useUIStore((s) => s.openSettings);
  const setMobileMoreOpen = useUIStore((s) => s.setMobileMoreOpen);
  const view = planUpgradeView(plan);
  if (!view) return null;
  const status = t(`sidebar.${view.status}`, { percent: view.percent });
  const tone =
    view.status === "limit"
      ? "text-danger-ink"
      : view.status === "nearLimit"
        ? "text-warning-ink"
        : "text-ink-muted";
  const Icon =
    view.status === "limit" || view.status === "nearLimit"
      ? CircleAlert
      : Sparkles;
  const open = () => {
    openSettings("plan", { nav });
    setMobileMoreOpen(false);
  };

  if (collapsed)
    return (
      <div className="flex justify-center py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className={cn(sidebarCollapsedItem.square, tone)}
              data-testid="plan-upgrade"
              aria-label={t("sidebar.collapsed", { status })}
              onClick={open}
            >
              <Icon className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {t("sidebar.collapsed", { status })}
          </TooltipContent>
        </Tooltip>
      </div>
    );

  return (
    <div className="px-4 py-1 md:px-2">
      <Button
        variant="outline"
        data-testid="plan-upgrade"
        className="h-auto min-h-12 w-full justify-start px-3 py-2 text-left"
        onClick={open}
      >
        <Icon className={cn("size-4", tone)} aria-hidden="true" />
        <span className="min-w-0 whitespace-normal">
          <span className="block text-sm">{t("upgrade")}</span>
          <span className={cn("block text-xs font-normal tabular-nums", tone)}>
            {status}
          </span>
        </span>
      </Button>
    </div>
  );
}
