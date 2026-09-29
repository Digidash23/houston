import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@houston-ai/core";
import type { ReactNode } from "react";
import { sidebarCollapsedItem } from "./sidebar-geometry";

interface SidebarCollapsedControlProps {
  /** The control's name: its `aria-label` and the tooltip beside it. */
  label: string;
  onClick: () => void;
  /** Its destination is the open view: `aria-current="page"`. */
  selected?: boolean;
  /** Shape and paint; the size is the collapsed item's square. */
  className?: string;
  dataAttrs?: Record<string, string>;
  children: ReactNode;
}

/**
 * A non-person control on the icon rail (the add seat, a connect row),
 * drawn at {@link sidebarCollapsedItem}'s square so it sits in the avatars'
 * column. The icon rail has no room for words, so the label is the button's
 * accessible name and a tooltip on the right, where every rail flyout opens.
 */
export function SidebarCollapsedControl({
  label,
  onClick,
  selected = false,
  className,
  dataAttrs,
  children,
}: SidebarCollapsedControlProps) {
  return (
    <div className="flex justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            {...(dataAttrs ?? {})}
            aria-label={label}
            aria-current={selected ? "page" : undefined}
            onClick={onClick}
            className={cn(
              "group/control relative flex shrink-0 items-center justify-center transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              sidebarCollapsedItem.square,
              className,
            )}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
