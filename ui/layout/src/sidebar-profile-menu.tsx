import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@houston-ai/core";
import type { ReactNode } from "react";
import { SidebarAvatarDiameter } from "./sidebar-avatar-diameter";
import { sidebarCollapsedItem, sidebarRailInset } from "./sidebar-geometry";
import {
  sidebarRowButtonClasses as row,
  sidebarRowState,
} from "./sidebar-paint";

export interface SidebarProfileMenuProps {
  /** A round portrait. It reads `useSidebarAvatarDiameter()` for its size,
   *  exactly like an agent row's avatar. */
  avatar: ReactNode;
  /** Who is signed in: the row's name line. */
  title: string;
  /** Where they are (the workspace): the quiet line under the name. */
  subtitle?: string;
  /** Icon-only rail: the portrait alone, named by a tooltip. */
  collapsed?: boolean;
  /** Where the menu opens: upward from the rail's foot by default, to the
   *  right from the icon rail. A trigger at the TOP of a surface (the phone's
   *  More card) opens it downward. */
  side?: "top" | "right" | "bottom";
  /** The menu's items, host-owned (`DropdownMenuItem`s, separators). */
  children: ReactNode;
  /** DOM attributes (tour anchor, test id) on the trigger's wrapper. */
  dataAttrs?: Record<string, string>;
}

/**
 * The foot of the rail, drawn the way macOS draws an account: a round
 * portrait, the name, and one quiet line under it, with no chevron and no
 * frame. Pressing the row opens the menu; the row does not need a glyph to
 * say so, because it is the only thing down there.
 *
 * It is a PERSON ROW, the same anatomy as every AI Employee above it (height,
 * portrait box, name and role type), so the rail ends on one more member of
 * the same list rather than on a control from a different kit. The second
 * line names the workspace, which keeps "where am I" on screen beside the
 * menu that switches it.
 *
 * The menu opens upward from the foot, or to the right from the icon rail,
 * unless the host names a `side`.
 */
export function SidebarProfileMenu({
  avatar,
  title,
  subtitle,
  collapsed = false,
  side,
  children,
  dataAttrs,
}: SidebarProfileMenuProps) {
  const content = (
    <DropdownMenuContent
      side={side ?? (collapsed ? "right" : "top")}
      align={collapsed ? "end" : "start"}
      sideOffset={collapsed ? 8 : 4}
      collisionPadding={8}
      className="w-60"
    >
      {children}
    </DropdownMenuContent>
  );

  if (collapsed) {
    return (
      <div className="flex justify-center px-2 pt-1 pb-2" {...dataAttrs}>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={title}
                  className={cn(
                    "flex items-center justify-center rounded-lg transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover",
                    sidebarCollapsedItem.square,
                  )}
                >
                  <SidebarAvatarDiameter
                    value={sidebarCollapsedItem.avatarDiameter}
                  >
                    {avatar}
                  </SidebarAvatarDiameter>
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            {/* Both lines, stacked: joining them into one string would be
                copy this i18n-agnostic package has no business composing. */}
            <TooltipContent
              side="right"
              sideOffset={8}
              className="flex flex-col items-start"
            >
              <span>{title}</span>
              {subtitle && <span className="opacity-70">{subtitle}</span>}
            </TooltipContent>
          </Tooltip>
          {content}
        </DropdownMenu>
      </div>
    );
  }

  return (
    // On the rail inset, so the portrait sits in the agents' portrait column.
    <div className={cn(sidebarRailInset, "pt-1 pb-2")} {...dataAttrs}>
      <div
        className={cn(
          row.root,
          row.personHeight,
          row.personFill,
          sidebarRowState.hover,
          "has-[>button[data-state=open]]:before:bg-sidebar-hover",
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                row.button,
                row.personHeight,
                row.personPadBlock,
                sidebarRowState.restText,
              )}
            >
              <span className={row.personIcon}>{avatar}</span>
              {/* The same two lines as an employee row, each in its own line
                  box: set straight into the column, the lines' `flex-1` would
                  split the row's height between them and pull them apart. */}
              <span className={cn(row.personText, row.personTextBare)}>
                <span className={row.personLine}>
                  <span className={row.personName}>{title}</span>
                </span>
                {subtitle && (
                  <span className={row.personLine}>
                    <span className={row.personRole}>{subtitle}</span>
                  </span>
                )}
              </span>
            </button>
          </DropdownMenuTrigger>
          {content}
        </DropdownMenu>
      </div>
    </div>
  );
}
