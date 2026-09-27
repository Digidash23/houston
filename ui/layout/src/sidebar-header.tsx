import { cn } from "@houston-ai/core";
import type { ReactNode } from "react";
import {
  sidebarWindowControlsHeight,
  sidebarWindowControlsWidth,
} from "./sidebar-geometry";
import { SidebarCollapseToggle } from "./sidebar-rail-chrome";

/**
 * The rail's top line. With windowControlsInset, the host draws its own window
 * controls over the rail's top-left, so the first row is a drag region that
 * reserves their zone: expanded it carries the collapse toggle after the
 * controls, and collapsed it stays empty with the expand toggle on the next
 * row. Without the inset, the expanded line has the same order (toggle, then
 * the actions at its end) and the collapsed toggle leads.
 *
 * `actions` (the host's search and create buttons) close the top line when
 * expanded, at its right edge, so the rail's own verbs sit on the line the
 * window chrome already spends. Collapsed, they stack under the toggle.
 */
export function SidebarHeader({
  actions,
  collapsed,
  windowControlsInset,
  collapseLabel,
  expandLabel,
  onToggleCollapsed,
}: {
  actions?: ReactNode;
  collapsed: boolean;
  windowControlsInset: boolean;
  collapseLabel: string;
  expandLabel: string;
  onToggleCollapsed?: () => void;
}) {
  const toggle = onToggleCollapsed ? (
    <SidebarCollapseToggle
      label={collapsed ? expandLabel : collapseLabel}
      onToggle={onToggleCollapsed}
      collapsed={collapsed}
    />
  ) : null;
  const stackedActions = actions ? (
    <div className="flex flex-col items-center gap-1 pb-1">{actions}</div>
  ) : null;

  if (windowControlsInset) {
    return (
      <>
        <div
          data-tauri-drag-region
          data-window-controls-row
          className={cn(
            "flex shrink-0 items-center",
            sidebarWindowControlsHeight,
          )}
        >
          {!collapsed && (
            <>
              <div
                data-tauri-drag-region
                className={cn("h-full shrink-0", sidebarWindowControlsWidth)}
              />
              {toggle}
              <div data-tauri-drag-region className="h-full min-w-0 flex-1" />
              {actions && (
                <div className="flex shrink-0 items-center gap-0.5 pr-2">
                  {actions}
                </div>
              )}
            </>
          )}
        </div>
        {collapsed && (
          <>
            <div
              data-tauri-drag-region
              className="flex justify-center pt-3 pb-1"
            >
              {toggle}
            </div>
            {stackedActions}
          </>
        )}
      </>
    );
  }

  return collapsed ? (
    <>
      <div className="flex justify-center pt-3 pb-1">{toggle}</div>
      {stackedActions}
    </>
  ) : (
    // The inset line's order without the window controls: the toggle leads,
    // the actions close the line.
    <div className="flex shrink-0 items-center gap-0.5 px-2 pt-3 pb-1">
      {toggle}
      <div className="min-w-0 flex-1" />
      {actions}
    </div>
  );
}
