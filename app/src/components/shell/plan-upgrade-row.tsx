import { type PlanUpgradeView, planUpgradeView } from "@houston/sdk";
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@houston-ai/core";
import {
  type SidebarSurface,
  sidebarRowType,
  sidebarSheetRowClasses,
} from "@houston-ai/layout";
import { CircleAlert, Gauge, type LucideIcon, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePlan } from "../../hooks/queries/use-plan";
import type { NavMode } from "../../lib/nav-stack";
import { useUIStore } from "../../stores/ui";

const GLYPH: Record<PlanUpgradeView["status"], LucideIcon> = {
  free: Sparkles,
  preview: Gauge,
  nearLimit: Gauge,
  limit: CircleAlert,
};

const TONE: Record<PlanUpgradeView["status"], string> = {
  free: "text-ink-muted",
  preview: "text-ink-muted",
  nearLimit: "text-warning-ink",
  limit: "text-danger-ink",
};

/** The way out drawn as a small filled pill inside the row, so it reads as
 *  an action even to someone who never opened Settings. */
function UpgradeChip({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full bg-action px-2 py-0.5 font-medium text-action-text text-xs">
      {label}
    </span>
  );
}

const RAIL_PILL =
  "flex items-center rounded-full bg-sidebar-hover text-ink ht-hairline transition-[background-color,transform] duration-200 hover:bg-sidebar-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.96]";

/**
 * The Free plan's way to Plus, on every screen: where the person stands
 * (`planUpgradeView`: Free, the 80% warning, the reached limit, or a launch
 * preview) beside an Upgrade chip that opens personal Billing. Plus and
 * deployments without personal plans draw nothing.
 *
 * The rail draws a one-line pill between the update notice and the connect
 * rows, the icon rail the glyph alone with the same name as a tooltip. The
 * phone's More card draws it as its own sheet row, navigating with
 * `nav: "reset"`. Every variant closes More, a no-op on the desktop.
 */
export function PlanUpgradeRow({
  collapsed = false,
  surface = "rail",
  nav,
}: {
  collapsed?: boolean;
  surface?: SidebarSurface;
  nav?: NavMode;
}) {
  const { t } = useTranslation("plan");
  const { data: plan } = usePlan();
  const openSettings = useUIStore((s) => s.openSettings);
  const setMobileMoreOpen = useUIStore((s) => s.setMobileMoreOpen);
  const view = planUpgradeView(plan);
  if (!view) return null;

  const status = t(`sidebar.${view.status}`, { percent: view.percent });
  const name = t("sidebar.label", { status });
  const Icon = GLYPH[view.status];
  const tone = TONE[view.status];
  const open = () => {
    openSettings("plan", { nav });
    setMobileMoreOpen(false);
  };
  const attrs = {
    type: "button" as const,
    onClick: open,
    "aria-label": name,
    "data-testid": "plan-upgrade",
    "data-status": view.status,
  };

  if (surface === "sheet")
    return (
      <button {...attrs} className={sidebarSheetRowClasses}>
        <span className="flex size-5 shrink-0 items-center justify-center">
          <Icon aria-hidden="true" className={cn("size-5", tone)} />
        </span>
        <span className="min-w-0 flex-1 truncate tabular-nums">{status}</span>
        <UpgradeChip label={t("sidebar.upgrade")} />
      </button>
    );

  if (collapsed)
    return (
      <div className="flex justify-center px-2 py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              {...attrs}
              className={cn(RAIL_PILL, "size-8 shrink-0 justify-center")}
            >
              <Icon aria-hidden="true" className={cn("size-4", tone)} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {name}
          </TooltipContent>
        </Tooltip>
      </div>
    );

  return (
    <div className="px-2 py-1">
      <button
        {...attrs}
        className={cn(RAIL_PILL, "min-h-8 w-full min-w-0 gap-2 py-1 pr-1 pl-3")}
      >
        <Icon aria-hidden="true" className={cn("size-4 shrink-0", tone)} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left tabular-nums",
            sidebarRowType.item,
          )}
        >
          {status}
        </span>
        <UpgradeChip label={t("sidebar.upgrade")} />
      </button>
    </div>
  );
}
